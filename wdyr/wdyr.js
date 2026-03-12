import React from "react";
import whyDidYouRender from "@welldone-software/why-did-you-render";
import { createDefaultNotifier } from "./notifier-api.js";

const notifier = createDefaultNotifier(1000, whyDidYouRender.wdyrStore);

whyDidYouRender(React, {
  include: [/.*/g],
  logOnDifferentValues: true,
  notifier,
  trackAllPureComponents: true,
});
