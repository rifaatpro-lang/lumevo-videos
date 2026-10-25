#!/usr/bin/env python3
"""Musique de fond originale pour les vidéos Lumevo SANS voix off.

Compose une petite musique entraînante (accords + arpège + batterie), 100 % générée
ici : aucun droit d'auteur, aucune licence à vérifier.

Usage : python3 outils/musique_fond.py DUREE_S SORTIE.wav [--graine N] [--style pop|chill|tension]
  - DUREE_S : durée de la vidéo (la musique fait cette durée, fondu en fin)
  - --graine : change la mélodie (prendre par ex. le jour du mois pour varier)
  - --style : pop (défaut, énergique) · chill (plus doux) · tension (pour un sujet "danger")
Sortie : WAV stéréo 48 kHz normalisé à -16 LUFS, crête ≤ -2 dB (via ffmpeg).
Pour mixer les bruitages par-dessus, les ajouter APRÈS (amix) en gardant la musique ~ -4 dB sous les effets.
"""
import argparse, subprocess, sys, tempfile, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter

SR = 48000
STYLES = {
    "pop":     dict(bpm=118, prog=[[0,4,7],[7,11,14],[9,12,16],[5,9,12]], root=60, swing=0.0),
    "chill":   dict(bpm=96,  prog=[[0,4,7,11],[9,12,16,19],[5,9,12,16],[7,11,14,17]], root=57, swing=0.08),
    "tension": dict(bpm=112, prog=[[0,3,7],[8,12,15],[3,7,10],[10,14,17]], root=57, swing=0.0),
}

def f(m): return 440.0 * 2 ** ((m - 69) / 12)

def env(n, a=0.005, r=0.2):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)
    return e

def lp(x, fc):
    b, a = butter(2, fc / (SR / 2), "low"); return lfilter(b, a, x)

def hp(x, fc):
    b, a = butter(2, fc / (SR / 2), "high"); return lfilter(b, a, x)

def saw(fr, n, rng):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-0.08, 0.0, 0.08):  # léger désaccord = son "large"
        ph = rng.random()
        out += 2 * ((t * fr * 2 ** (d / 12) + ph) % 1) - 1
    return out / 3

def build(dur, seed, style):
    S = STYLES[style]; rng = np.random.default_rng(seed)
    beat = 60 / S["bpm"]; bar = 4 * beat
    total = int((dur + 0.5) * SR)
    L = np.zeros(total); R = np.zeros(total)
    root = S["root"] + int(rng.integers(-2, 3))
    prog = S["prog"][:]
    rot = int(rng.integers(0, 4)); prog = prog[rot:] + prog[:rot]
    arp_pat = rng.permutation([0, 1, 2, 1, 2, 0, 1, 2])
    nbars = int(np.ceil(dur / bar)) + 1
    duck = np.ones(total)
    for b in range(nbars):
        t0 = b * bar; ch = prog[b % len(prog)]
        i0 = int(t0 * SR); n = int(bar * SR)
        if i0 >= total: break
        n = min(n, total - i0)
        # Nappe d'accords
        pad = sum(saw(f(root + iv), n, rng) for iv in ch) / len(ch)
        pad = lp(pad, 1800) * np.minimum(1, np.arange(n) / (0.08 * SR)) * 0.22
        L[i0:i0+n] += pad; R[i0:i0+n] += pad * 0.9
        # Basse
        bl = int(beat * SR)
        for k in range(4):
            j = i0 + k * bl
            if j >= total: break
            m = min(bl, total - j)
            tb = np.arange(m) / SR
            bass = np.sin(2*np.pi*f(root - 24 + ch[0])*tb) * env(m, 0.005, 0.35) * 0.35
            L[j:j+m] += bass; R[j:j+m] += bass
        # Arpège (croches), commence à la 2e mesure pour une entrée progressive
        if b >= 1:
            el = beat / 2
            for k in range(8):
                ts = t0 + k * el + (S["swing"] * el if k % 2 else 0)
                j = int(ts * SR); m = int(el * SR * 0.95)
                if j + m >= total: break
                note = root + 12 + ch[arp_pat[k] % len(ch)]
                tt = np.arange(m) / SR
                pl = (np.sin(2*np.pi*f(note)*tt) + 0.3*np.sin(2*np.pi*2*f(note)*tt)) * env(m, 0.002, 0.12) * 0.16
                pan = 0.35 if k % 2 else -0.35
                L[j:j+m] += pl * (1 - pan); R[j:j+m] += pl * (1 + pan)
        # Batterie
        for k in range(8):
            j = i0 + int(k * beat / 2 * SR)
            if j >= total: break
            m = min(int(0.25 * SR), total - j); tt = np.arange(m) / SR
            if k % 2 == 0 and (b >= 1 or k == 0):  # grosse caisse sur les temps
                if k in (0, 4) or style == "pop":
                    kick = np.sin(2*np.pi*(50 + 90*np.exp(-tt*30))*tt) * np.exp(-tt*9) * 0.6
                    L[j:j+m] += kick; R[j:j+m] += kick
                    d = 1 - 0.35 * np.exp(-tt * 8)  # pompage léger de la nappe
                    duck[j:j+m] = np.minimum(duck[j:j+m], d)
            if k in (2, 6) and b >= 1:  # claquement
                nz = hp(rng.standard_normal(m), 1500) * np.exp(-tt*22) * 0.22
                L[j:j+m] += nz; R[j:j+m] += nz
            if b >= 2:  # charleston
                mh = min(int(0.05*SR), total - j)
                hh = hp(rng.standard_normal(mh), 7000) * np.exp(-np.arange(mh)/SR*60) * 0.08
                L[j:j+mh] += hh * 0.8; R[j:j+mh] += hh
    L *= duck; R *= duck
    L = L[:int(dur*SR)]; R = R[:int(dur*SR)]
    fade = int(min(1.5, dur/6) * SR)
    fi = int(0.3 * SR)
    for ch_ in (L, R):
        ch_[:fi] *= np.linspace(0, 1, fi); ch_[-fade:] *= np.linspace(1, 0, fade)
    st = np.stack([L, R], 1); st /= max(1e-9, np.abs(st).max()) / 0.9
    return st.astype(np.float32)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("duree", type=float); ap.add_argument("sortie")
    ap.add_argument("--graine", type=int, default=1)
    ap.add_argument("--style", choices=list(STYLES), default="pop")
    a = ap.parse_args()
    st = build(a.duree, a.graine, a.style)
    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, "raw.wav"); wavfile.write(raw, SR, st)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af",
                        "loudnorm=I=-16:TP=-3:LRA=11,aresample=48000,alimiter=limit=0.7:level=false,volume=-0.5dB", "-ar", "48000", a.sortie], check=True)
    print(f"MUSIQUE : {a.sortie} | {a.duree:.1f} s | style {a.style} | graine {a.graine} | originale, sans droits")

if __name__ == "__main__":
    main()
