require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, PermissionsBitField, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const prefixDataPath = './data/prefixes.json';
const configPath = './data/config.json';
const commands = new Collection();

client.once('ready', () => {
  console.log(`🟢 KikiBot conectado como ${client.user.tag}`);
  scheduleHighlight();
});

// Cargar configuración por servidor
let serverConfigs = {};
if (fs.existsSync(configPath)) {
  serverConfigs = JSON.parse(fs.readFileSync(configPath));
}

// Cargar prefijos
let prefixes = {};
if (fs.existsSync(prefixDataPath)) {
  prefixes = JSON.parse(fs.readFileSync(prefixDataPath));
}

// Comando /setup
const slashCommands = [
  new SlashCommandBuilder().setName('setup').setDescription('Configura canales y rol premium (admins)'),
  new SlashCommandBuilder().setName('configurar').setDescription('Define tus canales de arte, premium y destacados'),
  new SlashCommandBuilder().setName('subir').setDescription('Sube un dibujo o animación (con filtro)').addAttachmentOption(opt => opt.setName('archivo').setDescription('Tu imagen').setRequired(true)),
  new SlashCommandBuilder().setName('cambiarprefijo').setDescription('Cambia el prefijo del bot').addStringOption(opt => opt.setName('nuevo').setDescription('Nuevo prefijo').setRequired(true)),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands.map(cmd => cmd.toJSON()) })
  .then(() => console.log('✅ Slash commands registrados'))
  .catch(console.error);

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const gid = interaction.guildId;

  if (interaction.commandName === 'setup') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: 'No tienes permisos.', ephemeral: true });

    const dibujos = await interaction.guild.channels.create({ name: 'dibujos', type: 0 });
    const destacados = await interaction.guild.channels.create({ name: 'destacados', type: 0 });
    const premium = await interaction.guild.roles.create({ name: 'Premium', color: 'Gold' });

    serverConfigs[gid] = {
      dibujos: dibujos.id,
      destacados: destacados.id,
      premium: premium.id
    };
    fs.writeFileSync(configPath, JSON.stringify(serverConfigs, null, 2));
    return interaction.reply('✅ Canales y rol creados');
  }

  if (interaction.commandName === 'configurar') {
    serverConfigs[gid] = serverConfigs[gid] || {};
    await interaction.reply('Usa /subir en el canal que quieras definir como arte.');
  }

  if (interaction.commandName === 'cambiarprefijo') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return interaction.reply({ content: 'No tienes permisos.', ephemeral: true });
    const nuevo = interaction.options.getString('nuevo');
    prefixes[gid] = nuevo;
    fs.writeFileSync(prefixDataPath, JSON.stringify(prefixes, null, 2));
    return interaction.reply(`✅ Prefijo cambiado a: \`${nuevo}\``);
  }

  if (interaction.commandName === 'subir') {
    const attachment = interaction.options.getAttachment('archivo');
    const ext = path.extname(attachment.url);
    const tipo = ext.includes('mp4') || ext.includes('gif') ? 'animación' : 'dibujo';

    const seguro = await verificarContenido(attachment.url);
    if (!seguro) return interaction.reply('❌ El contenido fue bloqueado por ser inapropiado.');

    const config = serverConfigs[gid];
    if (!config || !config.dibujos) return interaction.reply('❌ Canal no configurado.');

    const channel = await interaction.guild.channels.fetch(tipo === 'animación' ? config.premium : config.dibujos);
    await channel.send({ content: `📤 ${tipo} de ${interaction.user}:`, files: [attachment.url] });

    return interaction.reply(`✅ ${tipo} subido con éxito.`);
  }
});

// Función de verificación con Sightengine
async function verificarContenido(url) {
  try {
    const res = await fetch(`https://api.sightengine.com/1.0/check.json?models=nudity,wad,offensive&api_user=${process.env.MODERATION_API_USER}&api_secret=${process.env.MODERATION_API_KEY}&url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data.nudity.safe === true && data.weapon === 0 && data.gore === 0;
  } catch (err) {
    console.error('Error Sightengine:', err);
    return true;
  }
}

// Anuncio destacado los viernes
function scheduleHighlight() {
  setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 5 && now.getHours() === 12) {
      for (const gid in serverConfigs) {
        const cfg = serverConfigs[gid];
        try {
          const guild = await client.guilds.fetch(gid);
          const channel = await guild.channels.fetch(cfg.dibujos);
          const destacados = await guild.channels.fetch(cfg.destacados);
          const messages = await channel.messages.fetch({ limit: 20 });
          const arts = messages.filter(m => m.attachments.size > 0).first();
          if (arts) {
            destacados.send(`🌟 Dibujo destacado de ${arts.author}:
${[...arts.attachments.values()][0].url}`);
          }
        } catch (e) {
          console.error('Error destacando:', e);
        }
      }
    }
  }, 1000 * 60 * 60);
}

client.login(process.env.DISCORD_TOKEN);
