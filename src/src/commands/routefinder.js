import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runRouteScan } from '../scraper/airlineClub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const planesPath = path.join(dataDir, 'planes.json');
const basesPath  = path.join(dataDir, 'bases.json');

function readJson(p) {
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8') || '{}');
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

// Simple per-guild storage
function getGuildStore(gid) {
  const planes = readJson(planesPath);
  const bases  = readJson(basesPath);
  planes[gid] ||= [];
  bases[gid]  ||= [];
  return { planes, bases };
}
function saveGuildStore(gid, planes, bases) {
  writeJson(planesPath, planes);
  writeJson(basesPath,  bases);
}

export function buildCommands() {
  const base = new SlashCommandBuilder()
    .setName('routefinder')
    .setDescription('Finds the most profitable routes')
    .addSubcommandGroup(g =>
      g.setName('planelist').setDescription('Manage planes')
        .addSubcommand(s => s.setName('add').setDescription('Add plane by name or id')
          .addStringOption(o => o.setName('plane').setDescription('plane name or id').setRequired(true)))
        .addSubcommand(s => s.setName('delete').setDescription('Delete plane')
          .addStringOption(o => o.setName('plane').setDescription('plane name or id').setRequired(true)))
        .addSubcommand(s => s.setName('view').setDescription('View plane list'))
    )
    .addSubcommandGroup(g =>
      g.setName('baselist').setDescription('Manage HQ/Base airports')
        .addSubcommand(s => s.setName('add').setDescription('Add base')
          .addStringOption(o => o.setName('iata').setDescription('Airport code (e.g., IST)').setRequired(true))
          .addIntegerOption(o => o.setName('quality').setDescription('Service quality (0-100)').setRequired(true)))
        .addSubcommand(s => s.setName('delete').setDescription('Delete base')
          .addStringOption(o => o.setName('iata').setDescription('Airport code').setRequired(true)))
        .addSubcommand(s => s.setName('view').setDescription('View base list'))
    )
    .addSubcommand(s =>
      s.setName('run')
       .setDescription('Run profitability scan')
       .addStringOption(o => o.setName('username').setDescription('credential key suffix, e.g., josh'))
    );

  return [base];
}

export async function handleInteraction(interaction) {
  if (interaction.commandName !== 'routefinder') return;

  const { planes, bases } = getGuildStore(interaction.guildId);

  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand(false);

  // /routefinder run [username]
  if (!group && sub === 'run') {
    await interaction.deferReply();
    const key = (interaction.options.getString('username') || 'josh').toUpperCase();
    const user = process.env[`AC_USER_${key}`];
    const pass = process.env[`AC_PASS_${key}`];
    if (!user || !pass) {
      return interaction.editReply(`No credentials found for **${key}**. Set AC_USER_${key} / AC_PASS_${key} in .env`);
    }
    const result = await runRouteScan({
      credentials: { user, pass },
      planes: planes[interaction.guildId] || [],
      bases:  bases[interaction.guildId]  || []
    });
    return interaction.editReply(result || 'Finished. (No qualifying routes found.)');
  }

  // /routefinder planelist|baselist ...
  if (group === 'planelist') {
    const p = interaction.options.getString('plane');
    if (sub === 'add') {
      planes[interaction.guildId].push(p);
      saveGuildStore(interaction.guildId, planes, bases);
      return interaction.reply(`Added plane: \`${p}\``);
    }
    if (sub === 'delete') {
      planes[interaction.guildId] = planes[interaction.guildId].filter(x => x.toLowerCase() !== p.toLowerCase());
      saveGuildStore(interaction.guildId, planes, bases);
      return interaction.reply(`Deleted plane: \`${p}\``);
    }
    if (sub === 'view') {
      const list = planes[interaction.guildId];
      return interaction.reply(list.length ? `Planes: ${list.join(', ')}` : 'Plane list is empty.');
    }
  }

  if (group === 'baselist') {
    const iata = interaction.options.getString('iata');
    if (sub === 'add') {
      const quality = interaction.options.getInteger('quality');
      bases[interaction.guildId].push({ iata, quality });
      saveGuildStore(interaction.guildId, planes, bases);
      return interaction.reply(`Added base: \`${iata}\` (quality ${quality})`);
    }
    if (sub === 'delete') {
      bases[interaction.guildId] = bases[interaction.guildId].filter(x => x.iata.toUpperCase() !== iata.toUpperCase());
      saveGuildStore(interaction.guildId, planes, bases);
      return interaction.reply(`Deleted base: \`${iata}\``);
    }
    if (sub === 'view') {
      const list = bases[interaction.guildId];
      return interaction.reply(list.length ? 'Bases:\n' + list.map(b => `• ${b.iata} (Q${b.quality})`).join('\n') : 'Base list is empty.');
    }
  }
}
