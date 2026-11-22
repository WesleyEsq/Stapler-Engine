/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  Pathfinder,
  TileMapBuilder,
  parseDialogueScript,
  parseTiledMap,
  type DialogueStatement,
  type LocaleBundle,
} from '@stapler/engine';
import { PAPER_EXPRESSIONS_MANIFEST } from './manifest';

import mainStudioRaw from '../public/assets/maps/milestone2_demo.tmj?raw';
import studyClosetRaw from '../public/assets/maps/study_closet.tmj?raw';
import assistantDlg from '../public/assets/scripts/assistant_greeting.dlg?raw';
import studyDoorDlg from '../public/assets/scripts/study_door.dlg?raw';
import studyTerminalDlg from '../public/assets/scripts/study_terminal.dlg?raw';
import hallwayNoticeDlg from '../public/assets/scripts/hallway_notice.dlg?raw';
import enLocaleRaw from '../public/assets/locales/en.json?raw';
import esLocaleRaw from '../public/assets/locales/es.json?raw';

function collectStatements(list: readonly DialogueStatement[]): DialogueStatement[] {
  const flat: DialogueStatement[] = [];
  for (const stmt of list) {
    flat.push(stmt);
    if (stmt.type === 'if') {
      flat.push(...collectStatements(stmt.thenBranch));
      flat.push(...collectStatements(stmt.elseBranch));
    }
  }
  return flat;
}

describe('Paper expressions content integrity', () => {
  const mapsByEnv = {
    main_studio: parseTiledMap(JSON.parse(mainStudioRaw), PAPER_EXPRESSIONS_MANIFEST.engineConfig),
    study_closet: parseTiledMap(JSON.parse(studyClosetRaw), PAPER_EXPRESSIONS_MANIFEST.engineConfig),
  };

  const scriptsById: Record<string, string> = {
    assistant_greeting: assistantDlg,
    study_door: studyDoorDlg,
    study_terminal: studyTerminalDlg,
    hallway_notice: hallwayNoticeDlg,
  };

  const locales: Record<string, LocaleBundle> = {
    en: JSON.parse(enLocaleRaw) as LocaleBundle,
    es: JSON.parse(esLocaleRaw) as LocaleBundle,
  };

  it('validates all maps, patrol paths, trigger targets, and L-shaped navigation', () => {
    for (const [envId, parsed] of Object.entries(mapsByEnv)) {
      const envCfg = PAPER_EXPRESSIONS_MANIFEST.environments[envId];
      expect(envCfg).toBeDefined();

      // Shadow caster budget check (<= 2)
      const shadowCount = [...envCfg!.lights, ...parsed.lights].filter((l) => l.castShadow).length;
      expect(shadowCount).toBeLessThanOrEqual(2);

      // Every NPC patrolPath must exist in the same map and spriteId must exist in manifest
      for (const npc of parsed.npcs) {
        expect(PAPER_EXPRESSIONS_MANIFEST.sprites[npc.spriteId]).toBeDefined();
        if (npc.patrolPath) {
          expect(parsed.patrolPaths[npc.patrolPath]?.length).toBeGreaterThanOrEqual(2);
        }
        if (npc.scriptId) {
          expect(scriptsById[npc.scriptId]).toBeDefined();
        }
      }

      // Every trigger targetEnv/targetSpawnId and scriptId must resolve cleanly
      for (const trig of parsed.triggers) {
        if (trig.scriptId) {
          expect(scriptsById[trig.scriptId]).toBeDefined();
        }
        if (trig.targetEnv) {
          const targetMap = mapsByEnv[trig.targetEnv as keyof typeof mapsByEnv];
          expect(targetMap).toBeDefined();
          if (trig.targetSpawnId) {
            expect(targetMap.spawns[trig.targetSpawnId]).toBeDefined();
          }
        }
      }
    }

    // L-shaped void corner (0,0) blocked & A* routes from spawn_start around interior wall
    const builtMain = TileMapBuilder.build(mapsByEnv.main_studio);
    expect(builtMain.navGrid.isTileBlocked(0, 0)).toBe(true);
    const spawn = mapsByEnv.main_studio.spawns.spawn_start!;
    const path = Pathfinder.findPath(builtMain.navGrid, spawn, { x: 13.7, z: 1.2 }, { agentRadius: 0.28 });
    expect(path.length).toBeGreaterThanOrEqual(2);
  });

  it('validates every .dlg script parses cleanly and all keys/speakers/transitions exist across all locales', () => {
    for (const [scriptId, source] of Object.entries(scriptsById)) {
      expect(PAPER_EXPRESSIONS_MANIFEST.scripts?.[scriptId]).toBeDefined();
      const statements = collectStatements(parseDialogueScript(source));

      for (const stmt of statements) {
        if (stmt.type === 'say') {
          for (const [lang, bundle] of Object.entries(locales)) {
            expect(bundle.speakers[stmt.speaker], `Missing speaker "${stmt.speaker}" in ${lang}`).toBeDefined();
            expect(bundle.lines[stmt.lineKey], `Missing line "${stmt.lineKey}" in ${lang}`).toBeDefined();
          }
        }
        if (stmt.type === 'transition') {
          const targetMap = mapsByEnv[stmt.environmentId as keyof typeof mapsByEnv];
          expect(targetMap, `Unknown transition env "${stmt.environmentId}" in ${scriptId}`).toBeDefined();
          expect(
            targetMap.spawns[stmt.spawnId],
            `Unknown spawn "${stmt.spawnId}" in "${stmt.environmentId}"`,
          ).toBeDefined();
        }
      }
    }

    // Every manifest environment titleKey must exist in all locales
    for (const env of Object.values(PAPER_EXPRESSIONS_MANIFEST.environments)) {
      for (const [lang, bundle] of Object.entries(locales)) {
        expect(
          bundle.environments?.[env.titleKey],
          `Missing environment title "${env.titleKey}" in ${lang}`,
        ).toBeDefined();
      }
    }
  });
});
