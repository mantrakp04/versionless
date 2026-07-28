import { MDX_COMPONENT_NAMES } from "./registry";

const ALLOWED_COMPONENTS = new Set<string>(MDX_COMPONENT_NAMES);
const ALLOWED_INTRINSIC_ELEMENTS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

interface AstNode {
  type?: string;
  name?: string | null;
  attributes?: AstNode[];
  children?: AstNode[];
  value?: unknown;
  data?: {
    estree?: EstreeNode;
  };
  body?: EstreeNode[];
  expression?: EstreeNode;
  elements?: Array<EstreeNode | null>;
  properties?: EstreeNode[];
  key?: EstreeNode;
  computed?: boolean;
  kind?: string;
  method?: boolean;
  shorthand?: boolean;
  operator?: string;
  argument?: EstreeNode;
  expressions?: EstreeNode[];
}

type EstreeNode = AstNode;

function isStaticExpression(node: EstreeNode | undefined): boolean {
  if (!node?.type) return false;
  if (node.type === "Literal") {
    return (
      node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean"
    );
  }
  if (node.type === "ArrayExpression") {
    return (
      node.elements?.every(
        (element) => element !== null && isStaticExpression(element),
      ) ?? false
    );
  }
  if (node.type === "ObjectExpression") {
    return (
      node.properties?.every(
        (property) =>
          property.type === "Property" &&
          property.kind === "init" &&
          property.computed === false &&
          property.method === false &&
          property.shorthand === false &&
          (property.key?.type === "Identifier" ||
            property.key?.type === "Literal") &&
          isStaticExpression(property.value as EstreeNode | undefined),
      ) ?? false
    );
  }
  if (node.type === "UnaryExpression") {
    return (
      (node.operator === "-" || node.operator === "+") &&
      node.argument?.type === "Literal" &&
      typeof node.argument.value === "number"
    );
  }
  if (node.type === "TemplateLiteral") {
    return node.expressions?.length === 0;
  }
  return false;
}

function isStaticAttributeExpression(node: AstNode): boolean {
  const program = node.data?.estree;
  return (
    program?.type === "Program" &&
    program.body?.length === 1 &&
    program.body[0]?.type === "ExpressionStatement" &&
    isStaticExpression(program.body[0].expression)
  );
}

function validateNode(node: AstNode): void {
  if (node.type === "mdxjsEsm") {
    throw new Error("Imports and exports are not allowed in assistant MDX");
  }
  if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
    throw new Error("JavaScript expressions are not allowed in assistant MDX");
  }
  if (
    node.type === "mdxJsxFlowElement" ||
    node.type === "mdxJsxTextElement"
  ) {
    if (
      !node.name ||
      (!ALLOWED_COMPONENTS.has(node.name) &&
        !ALLOWED_INTRINSIC_ELEMENTS.has(node.name))
    ) {
      throw new Error(`Element \`${node.name ?? "fragment"}\` is not allowed`);
    }

    for (const attribute of node.attributes ?? []) {
      if (
        attribute.type !== "mdxJsxAttribute" ||
        typeof attribute.name !== "string"
      ) {
        throw new Error("Spread attributes are not allowed in assistant MDX");
      }
      if (/^on[A-Z]/.test(attribute.name)) {
        throw new Error("Event handlers are not allowed in assistant MDX");
      }
      if (
        typeof attribute.value === "object" &&
        attribute.value !== null &&
        !isStaticAttributeExpression(attribute.value as AstNode)
      ) {
        throw new Error(
          `Attribute \`${attribute.name}\` must contain only static data`,
        );
      }
    }
  }

  for (const child of node.children ?? []) validateNode(child);
}

/**
 * Restricts model-authored MDX to declarative component composition. The
 * compiler may still produce JavaScript, but no model-authored executable
 * expression reaches that output.
 */
export function remarkSandboxPolicy() {
  return (tree: AstNode) => validateNode(tree);
}
