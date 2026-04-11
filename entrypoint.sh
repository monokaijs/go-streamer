#!/bin/bash
export HOME=/tmp
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

mkdir -p /tmp/pulse
cat > /tmp/pulse/default.pa << 'EOF'
load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="VirtualSink"
set-default-sink virtual_sink
EOF

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
  echo "[Audio] PulseAudio running with virtual sink"
else
  echo "[Audio] PulseAudio failed, using silent audio fallback"
  unset PULSE_SERVER
fi

export PULSE_SERVER="${PULSE_SERVER:-unix:${XDG_RUNTIME_DIR}/pulse/native}"
exec node dist/index.js
