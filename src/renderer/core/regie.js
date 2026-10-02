import { createDemoApi, createDemoNews } from '../demo.js';
import { Director } from '../director.js';
import { EmojiHeads } from '../emojiHeads.js';
import { GoalHorn } from '../horn.js';
import { NhlService } from '../nhlService.js';
import { OcrEngine } from '../ocrEngine.js';
import { VisionPipeline } from '../visionPipeline.js';
import { VoiceEngine } from '../voice/voiceEngine.js';

// La Régie complète, branchée sur une source d'image et de son (agent du lecteur intégré ou
// capture de l'écran en mode surcouche) : données LNH, vision, voix, klaxon, têtes émoji.
export function createRegie({ bridge, streams, getConfig, saveConfig, overlays, ui, demo = false, demoStart = 0 }) {
  const nhl = new NhlService({ api: demo ? createDemoApi(demoStart) : window.rondelle.nhl, news: demo ? createDemoNews(demoStart) : window.rondelle.news, getConfig });
  const ocr = new OcrEngine();
  const vision = new VisionPipeline({ ocr });
  const horn = new GoalHorn();
  const heads = new EmojiHeads();
  const voice = new VoiceEngine({ bridge });
  const director = new Director({ getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui, heads, voice });
  return { nhl, ocr, vision, horn, heads, voice, director };
}
