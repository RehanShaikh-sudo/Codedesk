#!/bin/sh
# Optional: block ALL network access for the user IDs that run student code.
# Needs a host that allows it:  docker run --cap-add NET_ADMIN -e BLOCK_EGRESS=1 ...
# (Free hosts such as Render / Hugging Face do not allow it; the server still starts without it.)
if [ "$BLOCK_EGRESS" = "1" ]; then
  START="${RUN_AS_UID:-20000}"
  END=$(( START + ${MAX_CONCURRENT:-4} * 4 - 1 ))
  iptables  -A OUTPUT -m owner --uid-owner "$START-$END" -j REJECT || echo "WARNING: could not block the network (is NET_ADMIN granted?)"
  ip6tables -A OUTPUT -m owner --uid-owner "$START-$END" -j REJECT || true
  echo "Network blocked for student programs (user IDs $START-$END)"
fi
exec node /app/index.js
