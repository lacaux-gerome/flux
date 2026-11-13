import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DAILY_TEMPLATE } from '../../shared/dailyTemplate'
import type { CheckResult } from '../../shared/types'
import { CONFIG, CONFIG_FILE as CONFIG_PATH } from '../config'
import { DAILY_COMMAND, DAILY_SKILL_DIR } from '../paths'
import { newSessionUrl, openInDesktop } from '../threads/desktop'
import { DAILY_CONTRACT } from './daily'

// The config file, written the way you would type it
const CONFIG_FILE = CONFIG_PATH.replace(homedir(), '~')

// Writes the generic skill where Flux looks for it, and never over one already there
export async function useDailyTemplate(): Promise<CheckResult> {
  if (existsSync(DAILY_COMMAND)) {
    return { ok: false, detail: `Un skill existe déjà : ${DAILY_COMMAND}` }
  }
  await mkdir(dirname(DAILY_COMMAND), { recursive: true })
  await writeFile(DAILY_COMMAND, DAILY_TEMPLATE, { flag: 'wx' })
  return { ok: true, detail: `Skill écrit : ${DAILY_COMMAND}` }
}

function renderBrief(): string {
  const tools = CONFIG.daily.allowedTools
  return `# Écrire le skill daily de Flux

Flux lance chaque matin le fichier \`${DAILY_COMMAND}\` avec \`claude -p\`, en lecture seule, et attend un JSON en retour. Ce fichier n'existe pas encore : il faut l'écrire avec l'utilisateur.

## Ce que fait le skill

Flux affiche lui-même Hier, les bloquants et le compte de la file. Le skill choisit les 3 intentions du jour parmi les candidats que Flux lui passe, raccourcit les titres, propose de quoi débloquer chaque bloquant et écrit la santé de la prod, une ligne par source.

Flux ajoute à la fin du skill les données du jour et cette forme de réponse, qu'il impose :

\`\`\`json
${DAILY_CONTRACT}
\`\`\`

Le skill n'a donc pas à décrire le JSON ni les données de Flux. Il dit comment choisir les intentions et, surtout, quelles sources de santé consulter.

## Ce qu'il faut demander

Pose les questions une à une :

1. Quelles sources de santé prod suivre : erreurs, monitoring, analytics, autre ? Pour chacune : l'outil MCP, le périmètre (org, projet, service), ce qui compte comme alerte, signal faible ou bonne nouvelle, et le lien vers la vue.
2. Comment classer les intentions, si l'ordre par défaut ne convient pas : d'abord ce qui débloque quelqu'un, puis ce qui attend depuis longtemps.
3. Les règles propres à l'équipe : seuils, horaires, sujets à ignorer.

## Le fichier à écrire

Pars du modèle générique ci-dessous et remplis la section « Sources de santé prod ». Écris le fichier à \`${DAILY_COMMAND}\` une fois l'utilisateur d'accord, et rien d'autre.

Les outils que le skill appelle doivent figurer dans \`daily.allowedTools\` de \`${CONFIG_FILE}\`. ${
    tools.length > 0
      ? `Ils sont aujourd'hui : ${tools.map(tool => `\`${tool}\``).join(', ')}.`
      : 'La liste est vide pour l’instant.'
  } Indique à l'utilisateur ceux à y ajouter, sans modifier ce fichier toi-même.

## Modèle générique

\`\`\`markdown
${DAILY_TEMPLATE}\`\`\`
`
}

// Opens a Claude Code session that writes the skill with the user, from a brief Flux leaves on disk
export async function createDailySkill(): Promise<void> {
  const brief = join(DAILY_SKILL_DIR, 'brief.md')
  await mkdir(DAILY_SKILL_DIR, { recursive: true, mode: 0o700 })
  await writeFile(brief, renderBrief())
  const prompt = `Lis ${brief} et suis-le : on écrit ensemble le skill daily de Flux.`
  await mkdir(dirname(DAILY_COMMAND), { recursive: true })
  await openInDesktop(newSessionUrl(prompt, [DAILY_SKILL_DIR, dirname(DAILY_COMMAND)]))
}
