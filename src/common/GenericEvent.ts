export type GenericEvent = {
  type: "reload-path";
  path: string;
  fileToSelect?: $Maybe<string>;
};
