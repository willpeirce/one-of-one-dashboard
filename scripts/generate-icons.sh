#!/usr/bin/env bash
set -euo pipefail

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_dir"

# ImageMagick 7; preserve the supplied mark on a white plate over the app's purple.
# The complete logo fits inside the central 320 x 200 area of the 512px icon.
magick -size 512x512 canvas:'#1e0f48' \
  -fill white -draw 'roundrectangle 64,128 448,384 24,24' \
  \( docs/spec/logo.png -filter Lanczos -resize 320x200 \) \
  -gravity center -compose Over -composite -strip -depth 8 PNG24:public/icon-512.png

magick public/icon-512.png -filter Lanczos -resize 192x192 -strip -depth 8 PNG24:public/icon-192.png
magick public/icon-512.png -filter Lanczos -resize 180x180 -strip -depth 8 PNG24:public/apple-touch-icon.png
