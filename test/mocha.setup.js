// Don't silently swallow unhandled rejections
process.on("unhandledRejection", (e) => {
  throw e;
});

// Minimal-Setup: nur chai.should aktivieren
const { should } = require("chai");
should();
