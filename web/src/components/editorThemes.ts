import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

export type EditorThemeId =
  | "tokyo-night"
  | "one-dark"
  | "dracula"
  | "monokai"
  | "github-light"
  | "solarized-light"

export interface EditorThemeOption {
  id: EditorThemeId
  name: string
  dark: boolean
}

export const EDITOR_THEMES: readonly EditorThemeOption[] = [
  { id: "tokyo-night", name: "Tokyo Night", dark: true },
  { id: "one-dark", name: "One Dark", dark: true },
  { id: "dracula", name: "Dracula", dark: true },
  { id: "monokai", name: "Monokai", dark: true },
  { id: "github-light", name: "GitHub Light", dark: false },
  { id: "solarized-light", name: "Solarized Light", dark: false }
]

function createViewTheme(
  dark: boolean,
  colors: {
    text: string
    caret: string
    gutter: string
    gutterActive: string
    activeLine: string
    selection: string
    bg?: string
  },
  fontSize = 14,
  fontFamily = "'JetBrains Mono', monospace"
) {
  return EditorView.theme(
    {
      "&": {
        color: colors.text,
        backgroundColor: colors.bg ?? "transparent",
        height: "100%",
        fontSize: `${fontSize}px`
      },
      ".cm-content": {
        fontFamily,
        caretColor: colors.caret,
        padding: "10px 0 40vh",
        lineHeight: "1.6"
      },
      ".cm-scroller": {
        WebkitOverflowScrolling: "touch"
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: colors.gutter,
        border: "none",
        paddingRight: "6px"
      },
      ".cm-activeLine": { backgroundColor: colors.activeLine },
      ".cm-activeLineGutter": {
        backgroundColor: colors.activeLine,
        color: colors.gutterActive
      },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: colors.selection
      },
      ".cm-cursor": { borderLeftColor: colors.caret },
      "&.cm-focused": { outline: "none" }
    },
    { dark }
  )
}

// 1. Tokyo Night (Dark)
const tokyoNightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#bb9af7" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#c0caf5" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7aa2f7" },
  { tag: [t.typeName, t.className, t.namespace], color: "#2ac3de" },
  { tag: [t.propertyName, t.attributeName], color: "#7dcfff" },
  { tag: [t.string, t.special(t.string)], color: "#9ece6a" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#ff9e64" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#565f89", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#f7768e" },
  { tag: [t.operator, t.punctuation], color: "#89ddff" },
  { tag: [t.bracket, t.paren, t.brace], color: "#c0caf5" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#89ddff", fontWeight: "bold" },
  { tag: t.link, color: "#73daca", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#b4f9f8" }
])

// 2. One Dark (Dark)
const oneDarkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#c678dd" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#abb2bf" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#61afef" },
  { tag: [t.typeName, t.className, t.namespace], color: "#e5c07b" },
  { tag: [t.propertyName, t.attributeName], color: "#abb2bf" },
  { tag: [t.string, t.special(t.string)], color: "#98c379" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#d19a66" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#5c6370", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#e06c75" },
  { tag: [t.operator, t.punctuation], color: "#56b6c2" },
  { tag: [t.bracket, t.paren, t.brace], color: "#abb2bf" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#61afef", fontWeight: "bold" },
  { tag: t.link, color: "#56b6c2", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#98c379" }
])

// 3. Monokai (Dark)
const monokaiHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#f92672" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#f8f8f2" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#a6e22e" },
  { tag: [t.typeName, t.className, t.namespace], color: "#66d9ef" },
  { tag: [t.propertyName, t.attributeName], color: "#a6e22e" },
  { tag: [t.string, t.special(t.string)], color: "#e6db74" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#ae81ff" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#75715e", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#f92672" },
  { tag: [t.operator, t.punctuation], color: "#f92672" },
  { tag: [t.bracket, t.paren, t.brace], color: "#f8f8f2" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#a6e22e", fontWeight: "bold" },
  { tag: t.link, color: "#66d9ef", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#e6db74" }
])

// 4. GitHub Light (Light)
const gitHubLightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#cf222e" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#24292f" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8250df" },
  { tag: [t.typeName, t.className, t.namespace], color: "#953800" },
  { tag: [t.propertyName, t.attributeName], color: "#116329" },
  { tag: [t.string, t.special(t.string)], color: "#0a3069" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#0550ae" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#6e7781", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#116329" },
  { tag: [t.operator, t.punctuation], color: "#0550ae" },
  { tag: [t.bracket, t.paren, t.brace], color: "#24292f" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#0550ae", fontWeight: "bold" },
  { tag: t.link, color: "#0969da", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#0a3069" }
])

// 5. Solarized Light (Light)
const solarizedLightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#859900" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#657b83" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#268bd2" },
  { tag: [t.typeName, t.className, t.namespace], color: "#b58900" },
  { tag: [t.propertyName, t.attributeName], color: "#657b83" },
  { tag: [t.string, t.special(t.string)], color: "#2aa198" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#d33682" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#93a1a1", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#268bd2" },
  { tag: [t.operator, t.punctuation], color: "#859900" },
  { tag: [t.bracket, t.paren, t.brace], color: "#657b83" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#268bd2", fontWeight: "bold" },
  { tag: t.link, color: "#2aa198", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#2aa198" }
])

// 6. Dracula (Dark)
const draculaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#ff79c6" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "#f8f8f2" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#50fa7b" },
  { tag: [t.typeName, t.className, t.namespace], color: "#8be9fd", fontStyle: "italic" },
  { tag: [t.propertyName, t.attributeName], color: "#ffb86c" },
  { tag: [t.string, t.special(t.string)], color: "#f1fa8c" },
  { tag: [t.number, t.integer, t.float, t.bool], color: "#bd93f9" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#6272a4", fontStyle: "italic" },
  { tag: [t.tagName, t.standard(t.tagName)], color: "#ff79c6" },
  { tag: [t.operator, t.punctuation], color: "#ff79c6" },
  { tag: [t.bracket, t.paren, t.brace], color: "#f8f8f2" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "#bd93f9", fontWeight: "bold" },
  { tag: t.link, color: "#8be9fd", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.regexp, color: "#ff5555" }
])

export function getEditorThemeExtension(
  themeId: EditorThemeId,
  fontSize = 14,
  fontFamily = "'JetBrains Mono', monospace"
): Extension {
  switch (themeId) {
    case "tokyo-night":
      return [
        createViewTheme(
          true,
          {
            text: "#c0caf5",
            caret: "#7aa2f7",
            gutter: "#565f89",
            gutterActive: "#c0caf5",
            activeLine: "rgba(255, 255, 255, 0.04)",
            selection: "#364a82"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(tokyoNightHighlight)
      ]
    case "one-dark":
      return [
        createViewTheme(
          true,
          {
            text: "#abb2bf",
            caret: "#528bff",
            gutter: "#4b5263",
            gutterActive: "#abb2bf",
            activeLine: "rgba(255, 255, 255, 0.035)",
            selection: "#3e4451"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(oneDarkHighlight)
      ]
    case "dracula":
      return [
        createViewTheme(
          true,
          {
            text: "#f8f8f2",
            caret: "#ff79c6",
            gutter: "#6272a4",
            gutterActive: "#f8f8f2",
            activeLine: "rgba(255, 255, 255, 0.04)",
            selection: "#44475a"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(draculaHighlight)
      ]
    case "monokai":
      return [
        createViewTheme(
          true,
          {
            text: "#f8f8f2",
            caret: "#f8f8f0",
            gutter: "#75715e",
            gutterActive: "#f8f8f2",
            activeLine: "rgba(255, 255, 255, 0.05)",
            selection: "#49483e"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(monokaiHighlight)
      ]
    case "solarized-light":
      return [
        createViewTheme(
          false,
          {
            text: "#657b83",
            caret: "#268bd2",
            gutter: "#93a1a1",
            gutterActive: "#657b83",
            activeLine: "rgba(7, 54, 66, 0.05)",
            selection: "#eee8d5"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(solarizedLightHighlight)
      ]
    case "github-light":
    default:
      return [
        createViewTheme(
          false,
          {
            text: "#24292f",
            caret: "#0969da",
            gutter: "#8c959f",
            gutterActive: "#24292f",
            activeLine: "rgba(0, 0, 0, 0.04)",
            selection: "#b6e3ff"
          },
          fontSize,
          fontFamily
        ),
        syntaxHighlighting(gitHubLightHighlight)
      ]
  }
}
