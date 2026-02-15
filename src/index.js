require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, AttachmentBuilder, PermissionsBitField } = require("discord.js");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const TOKEN = (process.env.DISCORD_TOKEN || "").trim();

// ===== TEKST POWITANIA =====
const WELCOME_TEXT =
  "Witaj w gronie Emosów! Jestem Łysy, założycielka Emo Students. Bardzo mi miło, że do nas dołączył*ś i mam nadzieję, że zostaniesz z nami na dłużej! Zapoznaj się z panującym regulaminem, a następnie przejdź do weryfikacji i baw się u nas dobrze!";

// ===== KANAŁY (PO NAZWIE, MAŁE LITERY) =====
const WELCOME_CHANNEL_NAME = "witamy";
const LEVEL_CHANNEL_NAME = "poziomy";

// ===== ASSETY =====
const BANNER_PATH = path.join(__dirname, "assets", "banner.png");

// ===== USTAWIENIA GRAFIKI =====
const AVATAR_DIAMETER = 300;
const AVATAR_BORDER = 10;
const Y_OFFSET = 0;
const USERNAME_FONT_SIZE = 47;
const USERNAME_GAP = 64;

// ===== LEVELING =====
const XP_PER_MESSAGE = 10;
const MESSAGE_COOLDOWN = 30_000;
const XP_PER_VOICE_MIN = 1;

function xpToNext(level) {
  return 100 + level * 50;
}

// ===== ROLE (Z EMOJI) =====
const ROLE_THRESHOLDS = {
  gadula: [
    { name: "Gaduła🥉", level: 20 },
    { name: "Gaduła🥈", level: 30 },
    { name: "Gaduła🥇", level: 40 },
  ],
  pisarz: [
    { name: "Pisarz🥉", level: 25 },
    { name: "Pisarz🥈", level: 45 },
    { name: "Pisarz🥇", level: 65 },
  ],
};

// ===== BAZA =====
const DATA_FILE = path.join(__dirname, "data.json");
let db = {};

function loadDB() {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
}
function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function getUser(gid, uid) {
  db[gid] ??= {};
  db[gid][uid] ??= {
    xp: 0,
    level: 0,
    messages: 0,
    voice: 0,
    lastMsg: 0,
    joinVoice: 0,
  };
  return db[gid][uid];
}

// ===== UTILS =====
function getChannel(guild, name) {
  return guild.channels.cache.find(
    ch => ch.isTextBased?.() && ch.name.toLowerCase() === name && ch.viewable
  ) || null;
}

function computeLevel(user) {
  const before = user.level;
  while (user.xp >= xpToNext(user.level)) {
    user.xp -= xpToNext(user.level);
    user.level++;
  }
  return { before, after: user.level };
}

async function ensureRoles(guild) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

  for (const group of Object.values(ROLE_THRESHOLDS)) {
    for (const r of group) {
      if (!guild.roles.cache.find(x => x.name === r.name)) {
        await guild.roles.create({ name: r.name }).catch(() => {});
      }
    }
  }
}

async function applyRoles(member, level) {
  const gained = [];
  const all = [...ROLE_THRESHOLDS.gadula, ...ROLE_THRESHOLDS.pisarz];
  const current = member.roles.cache.map(r => r.name);

  for (const r of all) {
    if (current.includes(r.name)) {
      const role = member.guild.roles.cache.find(x => x.name === r.name);
      if (role) await member.roles.remove(role).catch(() => {});
    }
  }

  for (const group of Object.values(ROLE_THRESHOLDS)) {
    let picked = null;
    for (const r of group) if (level >= r.level) picked = r.name;
    if (picked && !current.includes(picked)) {
      const role = member.guild.roles.cache.find(x => x.name === picked);
      if (role) {
        await member.roles.add(role).catch(() => {});
        gained.push(picked);
      }
    }
  }
  return gained;
}

// ===== GRAFIKA POWITALNA =====
async function buildWelcome(member) {
  const banner = await loadImage(BANNER_PATH);
  const canvas = createCanvas(banner.width, banner.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(banner, 0, 0);

  const avatar = await loadImage(member.displayAvatarURL({ extension: "png", size: 512 }));
  const cx = banner.width / 2;
  const cy = banner.height / 2 + Y_OFFSET;

  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_DIAMETER / 2 + AVATAR_BORDER, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_DIAMETER / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    avatar,
    cx - AVATAR_DIAMETER / 2,
    cy - AVATAR_DIAMETER / 2,
    AVATAR_DIAMETER,
    AVATAR_DIAMETER
  );
  ctx.restore();

  ctx.font = `${USERNAME_FONT_SIZE}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText(
    member.user.username,
    cx,
    cy + AVATAR_DIAMETER / 2 + USERNAME_GAP
  );

  return canvas.toBuffer("image/png");
}

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once("ready", () => {
  console.log(`✅ Zalogowano jako ${client.user.tag}`);
  loadDB();
  setInterval(saveDB, 30_000);
});

// ===== POWITANIE (REALNE) =====
client.on("guildMemberAdd", async member => {
  const channel = getChannel(member.guild, WELCOME_CHANNEL_NAME);
  if (!channel) return;

  try {
    const img = await buildWelcome(member);
    const file = new AttachmentBuilder(img, { name: "welcome.png" });
    await channel.send({ content: `${member}\n${WELCOME_TEXT}`, files: [file] });
  } catch {
    await channel.send(`${member}\n${WELCOME_TEXT}`);
  }
});

// ===== WIADOMOŚCI + TEST =====
client.on("messageCreate", async msg => {
  if (!msg.inGuild() || msg.author.bot) return;

  // === TEST POWITANIA ===
  if (msg.content.toLowerCase() === "!testwelcome") {
    const channel = getChannel(msg.guild, WELCOME_CHANNEL_NAME);
    if (!channel) {
      await msg.reply("❌ Nie widzę kanału `witamy`.");
      return;
    }
    try {
      const img = await buildWelcome(msg.member);
      const file = new AttachmentBuilder(img, { name: "welcome.png" });
      await channel.send({ content: `${msg.member}\n${WELCOME_TEXT}`, files: [file] });
      await msg.reply("✅ Testowe powitanie wysłane.");
    } catch {
      await msg.reply("❌ Problem z bannerem (`assets/banner.png`).");
    }
    return;
  }

  // === LEVELING ===
  const user = getUser(msg.guild.id, msg.author.id);
  user.messages++;

  const now = Date.now();
  if (now - user.lastMsg >= MESSAGE_COOLDOWN) {
    user.xp += XP_PER_MESSAGE;
    user.lastMsg = now;

    const { before, after } = computeLevel(user);
    if (after > before) {
      const member = await msg.guild.members.fetch(msg.author.id);
      await ensureRoles(msg.guild);
      const gained = await applyRoles(member, after);

      const ch = getChannel(msg.guild, LEVEL_CHANNEL_NAME);
      if (ch) {
        await ch.send(
          `🎉 <@${msg.author.id}> Gratulacje! Awansował*s z poziomu **${before}** na poziom **${after}**. Tak trzymaj!`
        );
        for (const r of gained) {
          await ch.send(
            `🏅 <@${msg.author.id}> Gratulacje! Zdobywasz odznakę **${r}**!`
          );
        }
      }
    }
  }
});

// ===== VOICE =====
client.on("voiceStateUpdate", async (oldS, newS) => {
  const member = newS.member || oldS.member;
  if (!member || member.user.bot) return;

  const user = getUser(member.guild.id, member.user.id);

  if (!oldS.channelId && newS.channelId) {
    user.joinVoice = Date.now();
  }

  if (oldS.channelId && !newS.channelId) {
    const delta = Math.floor((Date.now() - user.joinVoice) / 1000);
    user.voice += delta;
    user.joinVoice = 0;

    user.xp += Math.floor(delta / 60) * XP_PER_VOICE_MIN;
    const { before, after } = computeLevel(user);

    if (after > before) {
      await ensureRoles(member.guild);
      const gained = await applyRoles(member, after);
      const ch = getChannel(member.guild, LEVEL_CHANNEL_NAME);

      if (ch) {
        await ch.send(
          `🎉 <@${member.user.id}> Gratulacje! Awansował*s z poziomu **${before}** na poziom **${after}**. Tak trzymaj!`
        );
        for (const r of gained) {
          await ch.send(
            `🏅 <@${member.user.id}> Gratulacje! Zdobywasz odznakę **${r}**!`
          );
        }
      }
    }
  }
});

client.login(TOKEN);