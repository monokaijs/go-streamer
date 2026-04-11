#!/bin/bash
export HOME=/tmp
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

STREAM_WIDTH="${STREAM_WIDTH:-1280}"
STREAM_HEIGHT="${STREAM_HEIGHT:-720}"

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
pulseaudio --kill 2>/dev/null || true

Xvfb :99 -screen 0 "${STREAM_WIDTH}x${STREAM_HEIGHT}x24" -nolisten tcp &
sleep 1
export DISPLAY=:99
echo "[Video] Xvfb started on :99 (${STREAM_WIDTH}x${STREAM_HEIGHT})"

pulseaudio \
  --daemonize=yes \
  --exit-idle-time=-1 \
  --disallow-exit \
  --no-cpu-limit \
  --system=false \
  --log-target=stderr \
  -n \
  --load="module-native-protocol-unix" \
  --load="module-null-sink sink_name=virtual_sink sink_properties=device.description=VirtualSink" \
  --load="module-always-sink" \
  2>&1 || true
sleep 0.5

if pactl info >/dev/null 2>&1; then
  pactl set-default-sink virtual_sink
  export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
  echo "[Audio] PulseAudio running with virtual sink"
else
  echo "[Audio] PulseAudio failed, using silent audio fallback"
fi

exec node dist/index.js
