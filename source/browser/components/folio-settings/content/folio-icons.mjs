/* Folio's animated icons. The icons and their motions are Pulsoicon's (ISC license, pulsoicon/LICENSE.txt); the player below is
   Folio's own: it plays a motion with the browser's Web Animations instead of the Motion library (nothing extra to load, no
   CPU when nothing moves). An icon animates when the pointer enters or focus lands on its button, or when code calls .play();
   never on its own, never in a loop, and not at all when the system asks for reduced motion. */
import { iconFrame } from "./pulsoicon/frame.mjs";
import { ICONS } from "./pulsoicon/set.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const EASE = { easeIn: "ease-in", easeOut: "ease-out", easeInOut: "ease-in-out", linear: "linear", circIn: "ease-in", circOut: "ease-out", circInOut: "ease-in-out" };

const arr = (v) => (Array.isArray(v) ? v : [v]);

// One motion state ("animate") of one shape as Web Animations. Transform values use the individual CSS transform
// properties (translate, rotate, scale), so each can have its own number of keyframes, like Motion allows.
function play(el, state) {
  const { transition = {}, ...v } = state;
  const { opacity: opacityTiming, ...timing } = transition;
  const timeOf = (t) => ({
    duration: Math.max(1, (t.duration ?? 0.4) * 1000),
    delay: (t.delay ?? 0) * 1000,
    easing: EASE[t.ease] || "ease-in-out",
    fill: "none",
  });
  const frames = (list, make, t) => list.map((x, i) => {
    const f = make(x, i);
    if (t.times && t.times.length === list.length) f.offset = t.times[i];
    return f;
  });
  const out = [];
  const run = (keyframes, t) => { try { out.push(el.animate(keyframes, timeOf(t))); } catch (e) { /* a value this engine refuses: skip it */ } };

  if (v.x !== undefined || v.y !== undefined) {
    const xs = arr(v.x ?? 0), ys = arr(v.y ?? 0), n = Math.max(xs.length, ys.length);
    const at = (a, i) => a[Math.min(i, a.length - 1)];
    run(frames(Array.from({ length: n }, (_, i) => i), (i) => ({ translate: `${at(xs, i)}px ${at(ys, i)}px` }), timing), timing);
  }
  if (v.rotate !== undefined) run(frames(arr(v.rotate), (a) => ({ rotate: `${a}deg` }), timing), timing);
  if (v.scale !== undefined || v.scaleX !== undefined || v.scaleY !== undefined) {
    const s = arr(v.scale ?? 1), sx = arr(v.scaleX ?? s), sy = arr(v.scaleY ?? s), n = Math.max(sx.length, sy.length);
    const at = (a, i) => a[Math.min(i, a.length - 1)];
    run(frames(Array.from({ length: n }, (_, i) => i), (i) => ({ scale: `${at(sx, i)} ${at(sy, i)}` }), timing), timing);
  }
  if (v.skewY !== undefined) run(frames(arr(v.skewY), (a) => ({ transform: `skewY(${a}deg)` }), timing), timing);
  if (v.opacity !== undefined) run(frames(arr(v.opacity), (o) => ({ opacity: o }), opacityTiming ? { ...timing, ...opacityTiming } : timing), opacityTiming ? { ...timing, ...opacityTiming } : timing);
  if (v.pathLength !== undefined || v.pathOffset !== undefined) {
    const ls = arr(v.pathLength ?? 1), os = arr(v.pathOffset ?? 0), n = Math.max(ls.length, os.length);
    const at = (a, i) => a[Math.min(i, a.length - 1)];
    run(frames(Array.from({ length: n }, (_, i) => i), (i) => ({ strokeDasharray: `${at(ls, i)} 1`, strokeDashoffset: `${-at(os, i) || 0}` }), timing), timing);
  }
  return out;
}

// A tiny cache of the drawings so a window that makes 40 icons builds each frame once.
const frameCache = new Map();

/** Make an icon as an <svg> element. opts: size (px), strokeWidth, trigger (the element whose hover/focus plays it), animated. */
export function makeIcon(doc, name, opts = {}) {
  const data = ICONS[name];
  if (!data) return null;
  const { size = 18, strokeWidth = 2, trigger } = opts;
  // The x never animates, anywhere (Sammy, 2026-11-26: "remove the x animations, they're annoying").
  const animated = name === "x" ? false : (opts.animated ?? true);
  const key = `${name}|${size}|${strokeWidth}`;
  if (!frameCache.has(key)) frameCache.set(key, iconFrame(data, { size, strokeWidth, color: "currentColor" }));
  const frame = frameCache.get(key);
  const moving = [];
  const build = (f) => {
    const node = doc.createElementNS(SVG_NS, f.tag);
    for (const [k, val] of Object.entries(f.attrs)) node.setAttribute(k, val);
    for (const c of f.children) node.append(build(c));
    if (f.motion) moving.push([node, f.motion]);
    return node;
  };
  const svg = build(frame);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("folio-pulso");
  let running = [];
  const reduced = () => !!doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const api = {
    play() {
      if (!animated || reduced()) return;
      for (const a of running) { try { a.cancel(); } catch (e) { /* already done */ } }
      running = moving.flatMap(([node, m]) => play(node, m.animate));
    },
  };
  svg.folioPlay = api.play;
  if (trigger) {
    trigger.addEventListener("pointerenter", api.play);
    trigger.addEventListener("focusin", api.play);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(ICONS);
