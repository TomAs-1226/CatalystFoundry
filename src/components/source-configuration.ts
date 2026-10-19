/** Edit only an unambiguous raw Onshape configuration. Complex link values remain intact for explicit review. */
export function editOnshapeConfiguration(
  configuration: string,
  parameterValues: Record<string, string>,
  id: string,
  value: string,
): { configuration: string; values: Record<string, string> } {
  const error = () =>
    new Error(
      "This configuration contains a complex value. Edit the exact configuration identifier below or paste its Onshape link; Foundry will not guess how to rewrite it.",
    );
  if (!id || /[;=]/.test(id) || value.includes(";")) throw error();
  const current: Record<string, string> = {};
  for (const entry of configuration === "default"
    ? []
    : configuration.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) throw error();
    const key = entry.slice(0, separator);
    if (Object.hasOwn(current, key)) throw error();
    current[key] = entry.slice(separator + 1);
  }
  const values = { ...parameterValues, [id]: value };
  if (
    Object.entries(values).some(
      ([key, entry]) => !key || /[;=]/.test(key) || entry.includes(";"),
    )
  )
    throw error();
  return {
    values,
    configuration: Object.entries({ ...current, ...values })
      .map(([key, entry]) => `${key}=${entry}`)
      .join(";"),
  };
}
