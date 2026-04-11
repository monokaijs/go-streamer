#!/bin/bash
export HOME=/tmp
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

STREAM_WIDTH="${STREAM_WIDTH:-1920}"
STREAM_HEIGHT="${STREAM_HEIGHT:-1080}"

if [ -f /tmp/stream_resolution ]; then
  source /tmp/stream_resolution
fi

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

killall -9 pulseaudio 2>/dev/null || true
rm -rf /tmp/runtime-root/pulse
rm -f /tmp/pulse-*
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

Xvfb :99 -screen 0 ${STREAM_WIDTH}x${STREAM_HEIGHT}x24 -nolisten tcp &
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
sleep 1

RETRY=0
while ! pactl info >/dev/null 2>&1; do
  RETRY=$((RETRY+1))
  if [ $RETRY -ge 3 ]; then
    break
  fi
  echo "[Audio] PulseAudio not ready, retrying ($RETRY/3)..."
  killall -9 pulseaudio 2>/dev/null || true
  rm -rf /tmp/runtime-root/pulse
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  sleep 0.5
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
  sleep 1
done

if pactl info >/dev/null 2>&1; then
  pactl set-default-sink virtual_sink
  export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
  echo "[Audio] PulseAudio running with virtual sink"
else
  echo "[Audio] PulseAudio failed after retries, using silent audio fallback"
fi

export STREAM_WIDTH STREAM_HEIGHT
exec node dist/index.js
