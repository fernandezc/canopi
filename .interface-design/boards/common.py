"""Shared pieces for board modules: data, map backgrounds, map annotations."""
import assets
from build import blob
from ds import *  # noqa: F401,F403

ORCHARD = "Le Sanctuaire d'Aylin – Verger Syntropique"
ORCH = assets.orchard()
STRATA = ['Emergent', 'High', 'Mid', 'Low']
CLOSE = ('1:75', '1 m', 52)
SITE = ('1:190', '5 m', 100)


def H(text, sub=''):
    s = f'<p style="margin: 4px 0 0; font-size: 15px; color: var(--muted); max-width: 860px;">{sub}</p>' if sub else ''
    return f'<div><h1 class="disp" style="font-size: 28px;">{esc(text)}</h1>{s}</div>'


def section(title, inner, extra=''):
    return f'<section style="display: flex; flex-direction: column; gap: 12px;{extra}"><h2 class="disp" style="font-size: 18px;">{esc(title)}</h2>{inner}</section>'


def close_map(overlay='plants-close', dim=0.0):
    d = f'<div style="position: absolute; inset: 0; background: var(--paper); opacity: {dim};"></div>' if dim else ''
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view, close up" style="transform-origin: 640px 470px; transform: scale(2.6);"></div>{d}'
            f'<img src="{blob(overlay)}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">')


def site_map(overlay='plants-site'):
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div>'
            f'<img src="{blob(overlay)}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">')


def z18_map():
    return f'<div class="map"><img src="{blob("site-z18")}" alt="Satellite view of the site"></div>'


def tag(x, y, text, live=False):
    return f'<span class="mtag{" live" if live else ""}" style="left: {x}px; top: {y}px;">{esc(text)}</span>'


def mname(x, y, text):
    return f'<span class="mname maplabel" style="left: {x}px; top: {y}px;">{esc(text)}</span>'


def cased(el):
    """An SVG overlay element drawn twice: a dark casing underneath so it reads on any imagery."""
    under = el.replace('stroke="#FFF3D6"', 'stroke="rgba(20,16,10,0.6)"').replace('stroke-width="2"', 'stroke-width="4"').replace('stroke-width="1.6"', 'stroke-width="3.6"').replace('stroke-width="2.2"', 'stroke-width="4.2"')
    return under + el


def selbox(x, y, w, h, rotate=True):
    """The selection box: 2 px ochre over a 5 px cream casing, no corner handles; one rotate handle above."""
    rot = ''
    if rotate:
        cx = x + w / 2
        rot = (f'<line x1="{cx}" y1="{y}" x2="{cx}" y2="{y - 22}" stroke="#9C5A16" stroke-width="2"></line>')
    svg = (f'<svg width="1440" height="900" style="position: absolute; inset: 0; overflow: visible;" aria-hidden="true">'
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#FFF8EC" stroke-width="5"></rect>'
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#9C5A16" stroke-width="2"></rect>{rot}</svg>')
    if rotate:
        svg += (f'<button type="button" class="ib sm" aria-label="Rotate selection (drag, or Ctrl Alt R to type an angle)" style="position: absolute; left: {x + w / 2 - 14}px; top: {y - 50}px; width: 28px; height: 28px; border-radius: 14px; '
                f'background: var(--surface); color: var(--accent-ink); border: 2px solid var(--accent); box-shadow: var(--shadow-sm);">{icon("rotate", "s16")}</button>')
    return svg


def statuschip(inner, label='Selection'):
    return (f'<div class="float" role="status" aria-label="{esc(label)}" style="position: absolute; left: 50%; transform: translateX(-50%); bottom: 12px; height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 12px; border-radius: 11px; font-size: 14px;">{inner}</div>')


def topchip(inner):
    return (f'<div class="float" style="position: absolute; left: 50%; transform: translateX(-50%); top: 72px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 5px 0 14px; border-radius: 20px; font-size: 14px;">{inner}</div>')


def chrome(active_tool='select', panel=None, name=ORCHARD, status='Saved', kind='ok', scale=SITE, labelled=False, hot=None, attrib='© Google',
           bearing=0, grid=False, **tb):
    return (topbar(name, status, kind, hot=hot, **tb) + toolrail(active_tool, labelled=labelled) + panelrail(panel)
            + viewchip(grid=grid) + zoombar(*scale, attrib=attrib, bearing=bearing))


SWATCHES = [('#AB5268', 'Raspberry'), ('#805878', 'Plum'), ('#B06045', 'Brick'), ('#B07A32', 'Ochre'), ('#887044', 'Bark'), ('#70814B', 'Olive'),
            ('#428063', 'Sage'), ('#398379', 'Teal'), ('#507F9B', 'Slate blue'), ('#82629B', 'Lavender'), ('#27231D', 'Ink'), ('#8C8579', 'Stone')]


def phone_zoom(top, bearing=0):
    """The phone zoom column, the only chrome in the visible map: inspection lens, zoom, Fit, Show my location, compass."""
    return (f'<div class="float" role="group" aria-label="Zoom" style="position: absolute; right: 8px; top: {top}px; display: flex; flex-direction: column; gap: 2px; padding: 4px;">'
            f'{ib("search", "Inspection lens", size="touch")}{ib("plus", "Zoom in", size="touch")}{ib("minus", "Zoom out", size="touch")}{ib("fit", "Fit to Design", size="touch")}'
            f'{ib("target", "Show my location", size="touch")}<div class="rule" role="separator" style="margin: 2px 4px;"></div>{compass(bearing, size="touch")}</div>')


def phone_tabs(active=None):
    """The sheet's tab row: Layers, Plants and Catalog as tabs, the other panels under More."""
    tabs = ''.join(f'<button type="button" role="tab" aria-selected="{"true" if t == active else "false"}" class="chip" style="min-height: 44px; flex-shrink: 0;">{t}</button>'
                   for t in ['Layers', 'Plants', 'Catalog'])
    more = f'<button type="button" class="chip" aria-haspopup="menu" style="min-height: 44px; flex-shrink: 0; margin-left: auto;">{icon("more")}More</button>'
    return f'<div style="display: flex; gap: 4px; padding-bottom: 8px;"><div role="tablist" aria-label="Panels" style="display: flex; gap: 4px; overflow-x: auto;">{tabs}</div>{more}</div>'


def phone_bar(inner, label='Selection'):
    """The context bar: the sheet's first row, one 44 px row (the selection, the armed tool, a chip), above the handle."""
    return (f'<div role="status" aria-label="{esc(label)}" style="min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 4px; '
            f'border-bottom: 1px solid var(--line); font-size: 14px;">{inner}</div>')
