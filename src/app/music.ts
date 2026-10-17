/**
 * A timeline's background music: played in a loop while the file is open,
 * faded in, paused while the page is hidden, stopped when the file closes.
 * The reader's Settings turn it off for every file; the speaker in the
 * toolbar — shown only for a file with music — turns the same setting off
 * and on. A browser may refuse to start sound before the reader has done
 * anything on the page (a file opened from the Finder): then the first click
 * or key starts it.
 */

import { t } from '../core/i18n';
import type { Music } from '../core/model';
import { byId } from './dom';
import { app, on } from './state';

/** Loud enough to be there, quiet enough to read by. */
const VOLUME = 0.5;
const FADE_MS = 2000;

let audio: HTMLAudioElement | null = null;
let url: string | null = null;
/** The music now loaded: its file hash. */
let loaded: string | null = null;
let fade = 0;
/** Waiting for the reader's first click or key, once. */
let waiting = false;

function stop(): void {
  cancelAnimationFrame(fade);
  audio?.pause();
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  audio = url = loaded = null;
}

function fadeIn(el: HTMLAudioElement): void {
  cancelAnimationFrame(fade);
  const from = performance.now();
  const step = (now: number) => {
    // A frame's time is when the frame began, which may be a little before `from`: below zero, setting the volume throws.
    el.volume = Math.max(0, Math.min(VOLUME, (VOLUME * (now - from)) / FADE_MS));
    if (el.volume < VOLUME) fade = requestAnimationFrame(step);
  };
  fade = requestAnimationFrame(step);
}

/** Starts it, or — when the browser wants the reader's hand first — waits for the first click or key. */
function start(el: HTMLAudioElement): void {
  el.volume = 0;
  el.play().then(
    () => fadeIn(el),
    () => {
      if (waiting) return;
      waiting = true;
      const go = () => {
        waiting = false;
        document.removeEventListener('pointerdown', go, true);
        document.removeEventListener('keydown', go, true);
        if (audio === el && !document.hidden) void el.play().then(() => fadeIn(el), () => undefined);
      };
      document.addEventListener('pointerdown', go, true);
      document.addEventListener('keydown', go, true);
    },
  );
}

/** Plays what the open file asks for, as the setting allows — after an open, an edit, a change of mind. */
export async function syncMusic(): Promise<void> {
  const session = app.session;
  const music: Music | undefined = session?.doc.music;
  const button = byId('music-toggle');
  button.hidden = !music;
  button.setAttribute('aria-pressed', String(app.settings.music));
  button.title = music?.title ? t('toolbar', 'Background music: {title}', { title: music.title }) : t('toolbar', 'Background music');
  if (!session || !music || !app.settings.music) {
    stop();
    button.dataset.state = music ? 'off' : '';
    return;
  }
  if (loaded !== music.file) {
    stop();
    loaded = music.file;
    // An exported page may have it in its folder, a file beside the page.
    const linked = session.store.linked(`audio/${music.file}.${music.ext}`);
    const blob = linked ? null : await session.store.audio(music.file, music.ext);
    // Another file, or no music, by the time the bytes came.
    if (loaded !== music.file || app.session !== session) return;
    if (!linked && !blob) {
      // Not in the file — or not handed to the store yet (a new timeline): asked again at the next sync.
      loaded = null;
      button.dataset.state = 'missing';
      return;
    }
    url = linked ?? URL.createObjectURL(blob!);
    const el = new Audio(url);
    el.loop = true;
    // A player stopped and let go may still say "pause" afterwards: only the current one is heard.
    el.addEventListener('playing', () => audio === el && (button.dataset.state = 'playing'));
    el.addEventListener('pause', () => audio === el && (button.dataset.state = 'paused'));
    audio = el;
  }
  if (audio && audio.paused && !document.hidden) start(audio);
}

export function setupMusic(toggle: (on: boolean) => void): void {
  byId('music-toggle').addEventListener('click', () => toggle(!app.settings.music));
  on('opened', () => void syncMusic());
  on('changed', () => void syncMusic());
  on('closed', () => void syncMusic());
  // Not into an empty room: paused while the page is hidden, back when it is seen.
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.pause();
    else if (app.settings.music) start(audio);
  });
}
