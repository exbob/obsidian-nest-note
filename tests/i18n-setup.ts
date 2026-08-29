import { beforeEach } from "vitest";
import { setLocaleForTests } from "../src/i18n";

beforeEach(() => {
  setLocaleForTests("zh");
});
