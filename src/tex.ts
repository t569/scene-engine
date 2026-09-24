import { SVG_NS } from './scene.ts';

/**
 * Typeset mathematics in a scene.
 *
 * The engine does not typeset. The host passes a renderer — KaTeX's
 * `renderToString` is the intended one — that turns TeX into HTML, and the
 * engine places that HTML in a `<foreignObject>`, the seam the architecture doc
 * reserved for foreign content. So a page that never shows a formula never
 * loads a typesetter.
 *
 * The renderer's output is inserted as HTML. That is safe for KaTeX with its
 * defaults (`trust: false` refuses `\href`, `\htmlClass` and the like), which
 * is what makes a model-authored `tex` string acceptable. A renderer that
 * passes its input through as HTML would not be — so don't write one.
 */
export type TexRenderer = (tex: string) => string;

export interface TexBox {
  width: number;
  height: number;
  color?: string;
  fontSize?: number;
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Rendered formula, centred on the node's origin like every other shape. */
export function texElement(html: string, box: TexBox): SVGElement {
  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('x', String(-box.width / 2));
  fo.setAttribute('y', String(-box.height / 2));
  fo.setAttribute('width', String(box.width));
  fo.setAttribute('height', String(box.height));
  // Formulas are read, not dragged: let pointer events reach what's beneath.
  fo.style.pointerEvents = 'none';

  const div = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
  div.style.cssText =
    'width:100%;height:100%;display:flex;align-items:center;justify-content:center;white-space:nowrap;';
  if (box.color) div.style.color = box.color;
  div.style.fontSize = `${box.fontSize ?? 16}px`;
  div.innerHTML = html;
  fo.appendChild(div);
  return fo;
}
