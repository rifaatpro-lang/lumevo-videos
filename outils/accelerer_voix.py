#!/usr/bin/env python3
"""Voix off Lumevo : traitement OBLIGATOIRE de chaque voix ElevenLabs (règle de Rifaat, 24/10/2026).

1. Pauses de plus de 0,30 s ramenées à 0,25 s (on garde 0,125 s au début et à la fin de chaque pause).
2. Accélération x1.15 de tout l'audio (atempo, la hauteur de voix ne change pas).
3. Conversion des temps de la transcription ElevenLabs (mots horodatés) vers l'audio final.

Usage :
  python3 outils/accelerer_voix.py VOIX.mp3 MOTS.json SORTIE.wav MOTS_FINAL.json
MOTS.json : liste [{"text":..., "start":..., "end":...}] (les balises [excited] etc. sont ignorées).
Le script affiche un contrôle final : vitesse appliquée et durée attendue vs obtenue.
"""
import json, re, subprocess, sys

VITESSE = 1.15
SEUIL, GARDE = 0.30, 0.125

def duree(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
                                capture_output=True, text=True, check=True).stdout)

def main(voix, mots_in, sortie, mots_out):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', voix, '-af', f'silencedetect=n=-35dB:d={SEUIL}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    coupes = [(s + GARDE, e - GARDE) for s, e in zip(st, en) if e - s > SEUIL and s > 0.3]

    def remap(t):
        r = t
        for a, b in coupes:
            if t >= b: r -= (b - a)
            elif t > a: r -= (t - a)
        return r / VITESSE

    morceaux, prec = [], 0.0
    for a, b in coupes:
        morceaux.append((prec, a)); prec = b
    morceaux.append((prec, None))
    fc = ''.join(f"[0:a]atrim={a}" + (f":{b}" if b else "") + f",asetpts=PTS-STARTPTS[p{i}];" for i, (a, b) in enumerate(morceaux))
    fc += ''.join(f"[p{i}]" for i in range(len(morceaux))) + f"concat=n={len(morceaux)}:v=0:a=1,atempo={VITESSE}[v]"
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', voix, '-filter_complex', fc, '-map', '[v]', '-ar', '48000', '-ac', '2', sortie], check=True)

    mots = [m for m in json.load(open(mots_in, encoding='utf-8')) if not m['text'].startswith('[')]
    for m in mots:
        m['start'], m['end'] = round(remap(m['start']), 3), round(remap(m['end']), 3)
    json.dump(mots, open(mots_out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    brut = duree(voix)
    attendu = (brut - sum(b - a for a, b in coupes)) / VITESSE
    obtenu = duree(sortie)
    ok = abs(obtenu - attendu) / attendu < 0.03
    print(f"CONTROLE VOIX : vitesse x{VITESSE} | pauses raccourcies : {len(coupes)} | "
          f"durée brute {brut:.2f} s -> attendue {attendu:.2f} s, obtenue {obtenu:.2f} s | {'OK' if ok else 'ECHEC'}")
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__); sys.exit(2)
    main(*sys.argv[1:])
