import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import {
	createEffect,
	createMemo,
	For,
	type JSX,
	Match,
	Switch,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Dynamic } from "solid-js/web";
import { unified } from "unified";
import { fixMarkdown } from "~/utils/markdown";
import NativeMapping from "./Native";

interface Props {
	text?: string;
	onError?: (error: unknown) => void;
}

const parser = unified().use(remarkParse).use(remarkMath).freeze();

// An in-text result arrives as a complete Markdown string. Render that
// snapshot once so each inline node need not retain a reactive AST and a
// separate set of reactive branches for every supported Markdown node type.
export const Md = (props: Props) => {
	const content = createMemo(() => {
		try {
			return parser
				.parse(fixMarkdown(props.text || ""))
				.children.map(renderNode);
		} catch (error) {
			props.onError?.(error);
			return [];
		}
	});
	return <>{content()}</>;
};

function renderNode(node: import("mdast").RootContent): JSX.Element {
	switch (node.type) {
		case "text":
			return node.value;
		case "inlineCode":
			return <code>{node.value}</code>;
		case "html":
			return <code>{node.value}</code>;
		case "code":
			return (
				<pre>
					<code>{node.value}</code>
				</pre>
			);
		case "paragraph":
			return (
				<p style={{ display: "contents" }}>{node.children.map(renderNode)}</p>
			);
		case "list": {
			const children = node.children.map(renderNode);
			return node.ordered ? (
				<ol style={{ display: "contents" }}>{children}</ol>
			) : (
				<ul style={{ display: "contents" }}>{children}</ul>
			);
		}
		case "listItem":
			return (
				<li style={{ display: "contents" }}>{node.children.map(renderNode)}</li>
			);
		case "heading":
			return (
				<Dynamic component={`h${node.depth}` as const}>
					{node.children.map(renderNode)}
				</Dynamic>
			);
		case "link":
			return (
				<a href={node.url} title={node.title || undefined}>
					{node.children.map(renderNode)}
				</a>
			);
		case "image":
			return (
				<img
					src={node.url}
					alt={node.alt || undefined}
					title={node.title || undefined}
				/>
			);
		case "math":
			return <Native.math content={node.value} center />;
		case "inlineMath":
			return <Native.math content={node.value} />;
		case "break":
			return <br />;
		case "thematicBreak":
			return <hr />;
		case "emphasis":
			return <em>{node.children.map(renderNode)}</em>;
		case "strong":
			return <strong>{node.children.map(renderNode)}</strong>;
		case "blockquote":
			return <blockquote>{node.children.map(renderNode)}</blockquote>;
		case "delete":
			return <del>{node.children.map(renderNode)}</del>;
		case "table":
			return <table>{node.children.map(renderNode)}</table>;
		case "tableRow":
			return <tr>{node.children.map(renderNode)}</tr>;
		case "tableCell":
			return <td>{node.children.map(renderNode)}</td>;
		default:
			return null;
	}
}

const Native = NativeMapping();
export const MdStyled = (props: Props) => {
	const [tree, setTree] = createStore({
		children: [] as import("mdast").RootContent[],
	});

	createEffect(() => {
		try {
			setTree(reconcile(parser.parse(fixMarkdown(props.text || ""))));
		} catch (error) {
			props.onError?.(error);
		}
	});

	return (
		<For each={tree.children}>{(child) => <RenderStyledNode {...child} />}</For>
	);
};

const Styled = NativeMapping(true, true);
const RenderStyledNode = (props: import("mdast").RootContent) => {
	return (
		<Switch>
			<Match when={props.type === "heading" && props}>
				{(node) => (
					<Dynamic
						component={Styled[`h${node().depth}` as keyof typeof Styled]}
					>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Dynamic>
				)}
			</Match>

			<Match when={props.type === "paragraph" && props}>
				{(node) => (
					<Styled.p>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.p>
				)}
			</Match>

			<Match when={props.type === "text" && props}>
				{(node) => <>{node().value}</>}
			</Match>

			<Match when={props.type === "emphasis" && props}>
				{(node) => (
					<Styled.em>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.em>
				)}
			</Match>

			<Match when={props.type === "strong" && props}>
				{(node) => (
					<Styled.strong>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.strong>
				)}
			</Match>

			<Match when={props.type === "inlineCode" && props}>
				{(node) => <Styled.code>{node().value}</Styled.code>}
			</Match>

			<Match when={props.type === "code" && props}>
				{(node) => (
					<Styled.pre>
						<Styled.code>{node().value}</Styled.code>
					</Styled.pre>
				)}
			</Match>

			<Match when={props.type === "link" && props}>
				{(node) => (
					<Styled.a href={node().url} title={node().title || undefined}>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.a>
				)}
			</Match>

			<Match when={props.type === "image" && props}>
				{(node) => (
					<Styled.img
						src={node().url}
						alt={node().alt || undefined}
						title={node().title || undefined}
					/>
				)}
			</Match>

			<Match when={props.type === "blockquote" && props}>
				{(node) => (
					<Styled.blockquote>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.blockquote>
				)}
			</Match>

			<Match when={props.type === "list" && props}>
				{(node) => (
					<Dynamic component={node().ordered ? Styled.ol : Styled.ul}>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Dynamic>
				)}
			</Match>

			<Match when={props.type === "listItem" && props}>
				{(node) => (
					<Styled.li>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.li>
				)}
			</Match>

			<Match when={props.type === "thematicBreak"}>
				<Styled.hr />
			</Match>

			<Match when={props.type === "break"}>
				<Styled.br />
			</Match>

			<Match when={props.type === "html" && props}>
				{(node) => (
					// For security reasons, raw HTML is not rendered
					<Styled.code>{node().value}</Styled.code>
				)}
			</Match>

			<Match when={props.type === "table" && props}>
				{(node) => (
					<Styled.table>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.table>
				)}
			</Match>

			<Match when={props.type === "tableRow" && props}>
				{(node) => (
					<Styled.tr>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.tr>
				)}
			</Match>

			<Match when={props.type === "tableCell" && props}>
				{(node) => (
					<Styled.td>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.td>
				)}
			</Match>

			<Match when={props.type === "delete" && props}>
				{(node) => (
					<Styled.del>
						<For each={node().children}>
							{(child) => <RenderStyledNode {...child} />}
						</For>
					</Styled.del>
				)}
			</Match>

			<Match when={props.type === "math" && props}>
				{(node) => <Styled.math content={node().value} center />}
			</Match>

			<Match when={props.type === "inlineMath" && props}>
				{(node) => <Styled.math content={node().value} />}
			</Match>

			<Match
				when={
					[
						"linkReference",
						"imageReference",
						"footnoteReference",
						"footnoteDefinition",
						"definition",
					].includes(props.type) && props
				}
			>
				{(node) => {
					console.warn(`Reference nodes not yet implemented: ${node().type}`);
					return null;
				}}
			</Match>

			<Match when={props.type === "yaml"}>
				{/* Frontmatter - typically not rendered */}
				{null}
			</Match>
		</Switch>
	);
};
