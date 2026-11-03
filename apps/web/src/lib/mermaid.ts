import { cssVar } from './theme';

let counter = 0;

/**
 * Rend un diagramme Mermaid avec les couleurs du thème et du volume courants.
 * `securityLevel: 'strict'`: Mermaid nettoie le SVG (DOMPurify) et refuse
 * les liens et le HTML dans les libellés.
 */
export async function renderMermaid(source: string): Promise<{ svg: string; width: number }> {
  const { default: mermaid } = await import('mermaid');
  const font = cssVar('--font-ui') || 'system-ui, sans-serif';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: font,
    themeVariables: {
      fontFamily: font,
      fontSize: '14px',
      background: cssVar('--paper'),
      primaryColor: cssVar('--vol-tint'),
      primaryBorderColor: cssVar('--vol'),
      primaryTextColor: cssVar('--ink'),
      textColor: cssVar('--ink'),
      lineColor: cssVar('--ink-3'),
      actorBkg: cssVar('--vol-tint'),
      actorBorder: cssVar('--vol'),
      actorTextColor: cssVar('--ink'),
      actorLineColor: cssVar('--rule-2'),
      signalColor: cssVar('--ink-2'),
      signalTextColor: cssVar('--ink'),
      sequenceNumberColor: cssVar('--vol-on'),
      labelBoxBkgColor: cssVar('--paper'),
      labelBoxBorderColor: cssVar('--rule-2'),
      noteBkgColor: cssVar('--hl'),
      noteBorderColor: cssVar('--hl-line'),
      activationBkgColor: cssVar('--vol-tint'),
      activationBorderColor: cssVar('--vol'),
      mainBkg: cssVar('--vol-tint'),
      nodeBorder: cssVar('--vol'),
      clusterBkg: cssVar('--desk'),
      clusterBorder: cssVar('--rule-2'),
    },
    sequence: { mirrorActors: false, diagramMarginX: 8, diagramMarginY: 8, actorMargin: 24, messageMargin: 34, boxMargin: 8, width: 112, height: 44, useMaxWidth: true },
    flowchart: { useMaxWidth: true, htmlLabels: false },
  });
  counter += 1;
  const { svg } = await mermaid.render(`mmd-${counter}`, source);
  const width = Number(/max-width:\s*([\d.]+)px/.exec(svg)?.[1] ?? 0);
  return { svg, width };
}
