import assert from "node:assert/strict";
import test from "node:test";
import { effortForModelChange, effortLabel } from "../lib/client/effort.js";

const model = (efforts, defaultEffort) => ({ model: "m", name: "M",
  efforts: efforts.map(id => ({ id, name: id.toUpperCase() })), ...(defaultEffort === undefined ? {} : { defaultEffort }) });

/**
 * The settings schema and the execution inputs both name a real effort, so the
 * route editor has no "provider default" sentinel it could persist. Every value
 * it stores has to be a concrete effort id.
 */
test("a model change stores a concrete effort, never an empty provider default", () => {
  // The current effort survives a switch to a model that still advertises it.
  assert.equal(effortForModelChange("high", model(["low", "high"])), "high");
  // Otherwise the model's own default is materialized.
  assert.equal(effortForModelChange("ultra", model(["low", "high"], "high")), "high");
  assert.equal(effortForModelChange("ultra", model(["low", "high"])), "low", "without a default the first advertised effort is used");
  // A default the model does not advertise cannot become the stored value.
  assert.equal(effortForModelChange("ultra", model(["low"], "max")), "low");
  // A model that advertises no reasoning keeps the stored effort: an empty
  // string here is exactly what the settings schema rejects.
  assert.equal(effortForModelChange("ultra", model([])), "ultra");
  assert.equal(effortForModelChange("ultra", undefined), "ultra", "an unknown model changes nothing");
  for (const target of [model([]), undefined, model(["low"])]) {
    assert.notEqual(effortForModelChange("ultra", target), "");
  }
});

test("an effort label names the stored value or shows its id", () => {
  assert.equal(effortLabel("high", model(["low", "high"])), "HIGH");
  assert.equal(effortLabel("ultra", model(["low", "high"])), "ultra", "an unadvertised stored value stays readable");
  assert.equal(effortLabel("high", undefined), "high");
});
