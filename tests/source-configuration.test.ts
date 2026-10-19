import { describe, expect, it } from "vitest";
import { editOnshapeConfiguration } from "../src/components/source-configuration";

describe("guided source configuration edits", () => {
  it("preserves identifiers not exposed by the configuration form", () => {
    const result = editOnshapeConfiguration(
      "Robot=Competition;VendorFlag=A=B",
      { Robot: "Competition" },
      "Robot",
      "Practice",
    );
    expect(result.configuration).toBe("Robot=Practice;VendorFlag=A=B");
    expect(result.values.Robot).toBe("Practice");
  });
  it("keeps explicit parameter defaults when editing a default configuration", () => {
    expect(
      editOnshapeConfiguration(
        "default",
        { Robot: "Competition", Gap: "1 mm" },
        "Robot",
        "Practice",
      ).configuration,
    ).toBe("Robot=Practice;Gap=1 mm");
  });
  it("retains units and raw value characters without double encoding", () => {
    expect(
      editOnshapeConfiguration(
        "Gap=1 in;Style=A&B",
        { Gap: "1 in" },
        "Gap",
        "25.4 mm",
      ).configuration,
    ).toBe("Gap=25.4 mm;Style=A&B");
  });
  it.each([
    "Robot=Competition;Robot=Practice",
    "Robot=Competition;ambiguous",
    "=Competition",
    "",
  ])(
    "rejects ambiguous identifiers instead of rewriting %s",
    (configuration) => {
      expect(() =>
        editOnshapeConfiguration(
          configuration,
          { Robot: "Competition" },
          "Robot",
          "Practice",
        ),
      ).toThrow("exact configuration");
    },
  );
  it("rejects a new value containing an ambiguous separator", () => {
    expect(() =>
      editOnshapeConfiguration(
        "Robot=Competition",
        { Robot: "Competition" },
        "Robot",
        "Practice;Unsafe=true",
      ),
    ).toThrow("exact configuration");
  });
});
