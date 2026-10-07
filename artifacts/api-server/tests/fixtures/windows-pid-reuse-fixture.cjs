process.on("message", (message) => {
  if (message?.type === "stop") process.exit(0);
});

setInterval(() => {}, 1_000);
