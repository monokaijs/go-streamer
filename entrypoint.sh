#!/bin/bash
export HOME=/tmp
export XDG_RUNTIME_DIR=/tmp/runtime
mkdir -p "$XDG_RUNTIME_DIR"

pulseaudio -D --exit-idle-time=-1 --disallow-exit
pactl load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="VirtualSink"
pactl set-default-sink virtual_sink
export PULSE_SERVER=unix:${XDG_RUNTIME_DIR}/pulse/native

echo "[Audio] PulseAudio started with virtual sink"
exec node dist/index.js
