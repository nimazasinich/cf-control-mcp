/** Minimal JSON-Schema subset validator for MCP tool arguments.
 *
 * Tool schemas in this project currently use: type, required, properties,
 * items, and enum. Keeping runtime validation on that same schema object means
 * discovery and execution cannot silently drift apart.
 */

export interface ValidationResult {
	ok: boolean;
	errors: string[];
}

type Schema = Record<string, unknown>;

function typeMatches(expected: string, value: unknown): boolean {
	switch (expected) {
		case "object": return Boolean(value) && typeof value === "object" && !Array.isArray(value);
		case "array": return Array.isArray(value);
		case "string": return typeof value === "string";
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "integer": return typeof value === "number" && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		default: return true;
	}
}

function validateValue(schema: Schema, value: unknown, path: string, errors: string[]): void {
	const expectedType = typeof schema.type === "string" ? schema.type : null;
	if (expectedType && !typeMatches(expectedType, value)) {
		errors.push(`${path} must be ${expectedType}`);
		return;
	}

	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path} must have length >= ${schema.minLength}`);
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path} must have length <= ${schema.maxLength}`);
		if (typeof schema.pattern === "string") {
			try {
				if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match required pattern`);
			} catch {
				errors.push(`${path} has an invalid schema pattern`);
			}
		}
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
		if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
	}

	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items`);
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items`);
	}

	if (Array.isArray(schema.enum)) {
		const caseInsensitive = schema.caseInsensitive === true && typeof value === "string";
		const matches = schema.enum.some((candidate) =>
			caseInsensitive && typeof candidate === "string"
				? candidate.toLowerCase() === value.toLowerCase()
				: Object.is(candidate, value),
		);
		if (!matches) {
			errors.push(`${path} must be one of: ${schema.enum.map(String).join(", ")}`);
			return;
		}
	}

	if (expectedType === "object" && value && typeof value === "object" && !Array.isArray(value)) {
		const object = value as Record<string, unknown>;
		const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
			? schema.properties as Record<string, Schema>
			: {};
		const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
		for (const key of required) {
			if (!(key in object) || object[key] === undefined || object[key] === null) errors.push(`${path}.${key} is required`);
		}
		for (const [key, child] of Object.entries(properties)) {
			if (key in object && object[key] !== undefined) validateValue(child, object[key], `${path}.${key}`, errors);
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(object)) {
				if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
			}
		}
	}

	if (expectedType === "array" && Array.isArray(value) && schema.items && typeof schema.items === "object") {
		for (let i = 0; i < value.length; i++) validateValue(schema.items as Schema, value[i], `${path}[${i}]`, errors);
	}
}

export function validateToolArguments(schema: Record<string, unknown>, args: unknown): ValidationResult {
	const errors: string[] = [];
	validateValue(schema, args, "$", errors);
	return { ok: errors.length === 0, errors };
}
