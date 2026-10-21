import { demoTranscript } from "../tests/demo.js";

// The transcript shows times in UTC, so it reads the same wherever it is run.
process.env.TZ = "UTC";

/** Print the demo transcript so it can be pasted into the README. */
demoTranscript().then(
  (text) => console.log(text),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
