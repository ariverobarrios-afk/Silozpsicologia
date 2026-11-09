"""Genera docs/Guia-paciente-Siloz.pdf — guía visual y sencilla de la web para pacientes.

Las capturas están en docs/img/ (hechas sobre la web real, con las marcas en rojo).
Uso:  python3 docs/generar_guia_paciente.py
"""
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    Table, TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "Guia-paciente-Siloz.pdf"
IMG = ROOT / "docs" / "img"
LOGO = ROOT / "client" / "public" / "images" / "logo-reloj-arena.png"

F = "/usr/share/fonts/truetype/crosextra/"
for n, f in [("Serif", "Caladea-Regular"), ("Serif-B", "Caladea-Bold"), ("Serif-I", "Caladea-Italic"),
             ("Sans", "Carlito-Regular"), ("Sans-B", "Carlito-Bold"), ("Sans-I", "Carlito-Italic")]:
    pdfmetrics.registerFont(TTFont(n, F + f + ".ttf"))
pdfmetrics.registerFont(TTFont("Badge", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans-I", boldItalic="Sans-B")

SAGE = colors.HexColor("#7A9B7F")
SAGE_DARK = colors.HexColor("#4A5D4F")
TEXT = colors.HexColor("#2F3832")
MUTED = colors.HexColor("#5E6E61")
CREAM = colors.HexColor("#F5F1E8")
SAGE_LIGHT = colors.HexColor("#E6EEE7")
LINE = colors.HexColor("#D9D2C3")
RED = colors.HexColor("#D9480F")  # mismo color que las marcas de las capturas

body = ParagraphStyle("body", fontName="Sans", fontSize=14, leading=19, textColor=TEXT, spaceAfter=8)
big = ParagraphStyle("big", parent=body, fontSize=16, leading=22)
h1 = ParagraphStyle("h1", fontName="Serif-B", fontSize=28, leading=33, textColor=SAGE_DARK, spaceAfter=4)
sub = ParagraphStyle("sub", parent=body, fontSize=15, leading=20, textColor=MUTED, spaceAfter=14)
kicker = ParagraphStyle("kicker", fontName="Sans-B", fontSize=11, leading=14, textColor=SAGE, spaceAfter=2)
step_t = ParagraphStyle("step_t", parent=body, fontName="Sans-B", fontSize=15, leading=19, textColor=SAGE_DARK, spaceAfter=1)
step_d = ParagraphStyle("step_d", parent=body, fontSize=13.5, leading=18, spaceAfter=0)
cell = ParagraphStyle("cell", parent=body, fontSize=14, leading=18, spaceAfter=0)
cell_b = ParagraphStyle("cell_b", parent=cell, fontName="Sans-B", textColor=SAGE_DARK)
price = ParagraphStyle("price", parent=cell, fontName="Serif-B", fontSize=22, leading=24, textColor=SAGE_DARK)

W = A4[0] - 2 * 18 * mm


class Badge(Flowable):
    """Círculo con número, igual que las marcas rojas de las capturas."""

    def __init__(self, text, color=RED, d=9 * mm):
        super().__init__()
        self.text, self.color, self.d = text, color, d
        self.width = self.height = d

    def draw(self):
        c = self.canv
        r = self.d / 2
        c.setFillColor(self.color)
        c.circle(r, r, r, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Badge", 14)
        c.drawCentredString(r, r - 5, self.text)


def P(t, s=body):
    return Paragraph(t, s)


def foto(name, width):
    path = IMG / f"{name}.jpg"
    w, h = PILImage.open(path).size
    return Image(str(path), width=width, height=width * h / w)


def pasos(items, width, color=RED):
    """items: (número, título, explicación). Número None = sin círculo."""
    rows = []
    for n, t, d in items:
        txt = [P(t, step_t)] + ([P(d, step_d)] if d else [])
        rows.append([Badge(n, color) if n else "", txt])
    t = Table(rows, colWidths=[12 * mm, width - 12 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return t


def caja(contenido, bg=SAGE_LIGHT, borde=SAGE, width=W):
    if not isinstance(contenido, list):
        contenido = [contenido]
    t = Table([[contenido]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 4, borde),
        ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    t.spaceBefore, t.spaceAfter = 8, 8
    return t


def truco(texto, width=W):
    return caja(P(f"<b>Truco:</b> {texto}", cell), width=width)


def titulo(num, t, s=None):
    out = [P(f"PASO {num}" if isinstance(num, int) else num, kicker), P(t, h1)]
    if s:
        out.append(P(s, sub))
    return out


def pantalla(img, items, img_w=72 * mm, nota=None, color=RED):
    """Foto a la izquierda, pasos numerados a la derecha."""
    gap = 8 * mm
    right = [pasos(items, W - img_w - gap, color)] + ([truco(nota, W - img_w - gap)] if nota else [])
    t = Table([[foto(img, img_w), right]], colWidths=[img_w + gap, W - img_w - gap])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


# --- Portada y pie de página -----------------------------------------------
def cover(c, doc):
    w, h = A4
    c.saveState()
    c.setFillColor(CREAM); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setFillColor(SAGE); c.rect(0, 0, w, 12 * mm, stroke=0, fill=1)
    c.drawImage(str(LOGO), w / 2 - 30 * mm, h - 110 * mm, 60 * mm, 60 * mm, mask="auto")
    c.setFillColor(SAGE_DARK); c.setFont("Serif-B", 34)
    c.drawCentredString(w / 2, h - 130 * mm, "Siloz Psicología")
    c.setFillColor(TEXT); c.setFont("Serif", 26)
    c.drawCentredString(w / 2, h - 152 * mm, "Guía fácil de la web")
    c.setFillColor(MUTED); c.setFont("Sans", 16)
    c.drawCentredString(w / 2, h - 164 * mm, "Paso a paso y con fotos")
    c.setFillColor(SAGE_DARK); c.setFont("Sans-B", 18)
    c.drawCentredString(w / 2, h - 188 * mm, "silozpsicologia.com")
    c.setFont("Sans", 11); c.setFillColor(MUTED)
    c.drawCentredString(w / 2, 22 * mm, "Silvia López · Psicóloga General Sanitaria")
    c.restoreState()


def page(c, doc):
    w, h = A4
    c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.5)
    c.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
    c.setFont("Sans", 10); c.setFillColor(MUTED)
    c.drawString(18 * mm, 9 * mm, "Siloz Psicología · silozpsicologia@gmail.com · 620 450 696")
    c.drawRightString(w - 18 * mm, 9 * mm, f"Página {doc.page - 1}")
    c.restoreState()


# --- Contenido ---------------------------------------------------------------
s = [PageBreak()]

# Antes de empezar
s += [P("ANTES DE EMPEZAR", kicker), P("Lo que tienes que saber", h1), Spacer(1, 6)]
s.append(pasos([
    ("✓", "Entra en <font color='#4A5D4F'>silozpsicologia.com</font>", "Desde el móvil, la tablet o el ordenador. Las fotos de esta guía son del móvil."),
    ("✓", "No tienes que registrarte", "No hace falta crear cuenta ni contraseña. No hay que descargar nada."),
    ("✓", "Las sesiones son por videollamada", "La terapia es 100% online y confidencial, desde tu casa."),
    ("✓", "Para empezar, pide la sesión de valoración", "Es la primera sesión: 25 €, 60 minutos. Se pide rellenando un formulario (te lo explicamos en el paso 3)."),
], W, color=SAGE))
s.append(Spacer(1, 6))
s.append(caja([P("<b>En esta guía:</b>", cell_b), P(
    "1. Las cookies &nbsp;·&nbsp; 2. Los botones de arriba &nbsp;·&nbsp; 3. Pedir cita &nbsp;·&nbsp; "
    "4. Precios &nbsp;·&nbsp; 5. Preguntas frecuentes &nbsp;·&nbsp; 6. Blog &nbsp;·&nbsp; "
    "7. Guías gratis &nbsp;·&nbsp; 8. Ansiedad y depresión &nbsp;·&nbsp; 9. Contacto &nbsp;·&nbsp; "
    "10. Si algo falla", cell)], bg=CREAM, borde=SAGE_DARK))
s.append(caja(P("<b>Cómo leer las fotos:</b> los <font color='#D9480F'><b>recuadros rojos con un número</b></font> "
                "señalan dónde tienes que pulsar. El número coincide con la explicación de al lado.", cell)))

# 1 Cookies
s += [PageBreak()] + titulo(1, "Las cookies", "Lo primero que verás al entrar es este aviso abajo de la pantalla.")
s.append(pantalla("cookies", [
    ("1", "Solo esenciales", "La web solo usa lo imprescindible para funcionar."),
    ("2", "Aceptar todas", "Además, se usan estadísticas de Google para mejorar la web."),
], img_w=95 * mm, nota="Las dos opciones valen. Elige la que quieras: la web funciona igual. "
                               "El aviso desaparece y no vuelve a salir."))

# 2 Botones de arriba + menú
s += [PageBreak()] + titulo(2, "Los botones de arriba", "Esta barra está siempre arriba, en todas las páginas.")
s.append(pantalla("inicio", [
    ("1", "El menú (tres rayas)", "Abre la lista de todas las secciones."),
    ("2", "Solicita tu cita", "El botón más importante. Abre el formulario para pedir cita."),
    ("3", "El círculo", "Te devuelve al principio de la web."),
]))
s.append(Spacer(1, 10))
s.append(pantalla("menu", [
    (None, "Así se ve el menú abierto", None),
    (None, "Inicio · Sobre mí", "Quién es Silvia y cómo trabaja."),
    (None, "Preguntas frecuentes", "Respuestas a las dudas más normales."),
    (None, "Tarifas", "Los precios."),
    (None, "Blog · Recursos", "Artículos para leer y guías gratis."),
], nota="Para cerrar el menú, pulsa la X donde antes estaban las tres rayas."))

# 3 Pedir cita
s += [PageBreak()] + titulo(3, "Pedir tu cita", "Pulsa el botón verde <b>Solicita tu cita</b>. Se abre esta ventana:")
s.append(pantalla("dialogo", [
    (None, "Esta es la ventana para pedir cita", "Se abre encima de la web."),
    (None, "También la encuentras en…", "Cualquier botón verde que diga <b>Reserva tu sesión</b>, y al final de la página de inicio."),
    (None, "¿Me he equivocado?", "Pulsa la <b>x</b> de arriba a la derecha para cerrarla. No se envía nada."),
], img_w=78 * mm, nota="En la página siguiente te explicamos cómo rellenarla, casilla por casilla."))

s += [PageBreak()] + titulo("PASO 3 · CONTINUACIÓN", "Rellena el formulario", "Las casillas con <b>*</b> son obligatorias. El resto, si quieres.")
s.append(pantalla("form_relleno", [
    ("1", "Tu nombre *", None),
    ("2", "Tu email *", "Revisa que esté bien escrito: la respuesta te llega aquí."),
    ("3", "Tu teléfono", "Si prefieres que te llamen."),
    ("4", "¿Qué te gustaría trabajar?", "Por ejemplo: ansiedad, autoestima…"),
    ("5", "¿Has ido antes a terapia?", "Elige Sí o No."),
    ("6", "¿Quieres empezar un proceso?", "Elige Sí o No."),
    ("7", "Mensaje *", "Cuéntalo con tus palabras. Mínimo 10 letras. No hace falta dar detalles."),
    ("8", "Pulsa el botón verde", "Espera unos segundos sin cerrar la página."),
], img_w=68 * mm))

s += [PageBreak()] + titulo("PASO 3 · CONTINUACIÓN", "¿Sale algo en rojo?", "No pasa nada. La web te avisa de lo que falta.")
s.append(pantalla("form_errores", [
    ("!", "«El nombre es requerido»", "Falta tu nombre."),
    ("!", "«Email inválido»", "El email está vacío o mal escrito. Tiene que ser como <i>nombre@gmail.com</i>."),
    ("!", "«El mensaje debe tener al menos 10 caracteres»", "Escribe un poco más en el mensaje."),
], img_w=68 * mm, nota="Arregla lo que está en rojo y vuelve a pulsar el botón verde."))

s += [PageBreak()] + titulo("PASO 3 · CONTINUACIÓN", "¡Ya está enviado!", "Si ves esta pantalla, tu mensaje ha llegado bien.")
s.append(pantalla("gracias", [
    ("✓", "¿Y ahora qué?", "Silvia te contestará lo antes posible, normalmente <b>en menos de 24 horas</b>, para quedar el día y la hora."),
    ("✓", "Mira tu email", "Revisa también la carpeta de <b>spam</b> o <b>correo no deseado</b>."),
    ("✓", "Mientras esperas…", "Puedes leer el blog o descargar las guías gratis con estos botones."),
], color=SAGE))

# 4 Precios
s += [PageBreak()] + titulo(4, "Precios", "Menú → <b>Tarifas</b>. Todas las sesiones son online.")
rows = [
    ["Sesión de valoración inicial", "25 €", "60 minutos", "La primera. Para conocerte y ver cómo trabajar."],
    ["Terapia individual", "55 €", "60 minutos", "Las sesiones normales."],
    ["Bono de 5 sesiones", "250 €", "5 sesiones", "Para hacer un proceso seguido."],
    ["Terapia de pareja o familia", "70 €", "75 minutos", "Para trabajar la relación."],
]
t = Table([[P(a, cell_b), P(b, price), P(c, cell), P(d, cell)] for a, b, c, d in rows],
          colWidths=[48 * mm, 26 * mm, 30 * mm, W - 104 * mm])
t.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ("BACKGROUND", (0, 0), (-1, 0), SAGE_LIGHT),
]))
s += [t, Spacer(1, 10), P("Así se ve en el ordenador:", step_t), foto("tarifas", W * 0.62)]
s.append(truco("Cada precio tiene su botón verde. Todos abren el mismo formulario del paso 3."))

# 5 FAQ
s += [PageBreak()] + titulo(5, "Preguntas frecuentes", "Menú → <b>Preguntas frecuentes</b>.")
s.append(pantalla("faq", [
    ("1", "Pulsa una pregunta", "Se abre la respuesta debajo. Vuelve a pulsar para cerrarla."),
    (None, "Preguntas que encontrarás:", "¿Cómo sé si necesito ir al psicólogo? · ¿En qué consiste la terapia? · "
     "¿Cómo encuentro un psicólogo adecuado? · ¿La terapia online es para todo el mundo? · "
     "¿Y si ya fui a terapia y no funcionó?"),
], img_w=70 * mm))

# 6 Blog
s += [PageBreak()] + titulo(6, "El blog", "Menú → <b>Blog</b>. Artículos cortos para entender lo que sientes.")
s.append(pantalla("blog", [
    ("1", "Leer más", "Pulsa aquí para abrir el artículo entero."),
], img_w=66 * mm))
s.append(Spacer(1, 8))
s.append(pantalla("articulo", [
    ("1", "Volver al Blog", "Para regresar a la lista de artículos."),
    (None, "Al final del artículo", "Verás otros artículos parecidos."),
], img_w=66 * mm))

# 7 Recursos
s += [PageBreak()] + titulo(7, "Guías gratis", "Menú → <b>Recursos</b>. Guías en PDF para leer cuando quieras.")
s.append(pantalla("recursos", [
    ("1", "Descargar PDF", "La guía se abre en otra pestaña. Desde ahí puedes leerla, guardarla o imprimirla."),
    (None, "Ahora mismo hay:", "«La ventana de tolerancia»: qué nos pasa cuando nos desbordamos o nos apagamos."),
], nota="Si no se abre, mira en la carpeta <b>Descargas</b> del móvil."))

# 8 Ansiedad y depresión
s += [PageBreak()] + titulo(8, "Páginas de ansiedad y depresión",
                            "Si llegas por un enlace a <b>silozpsicologia.com/ansiedad</b> o <b>/depresion</b>, verás esto:")
s.append(pantalla("ansiedad", [
    ("1", "Volver al inicio", "Te lleva a la web principal."),
    ("2", "Reserva tu sesión de valoración", "Te baja directamente a un formulario corto: nombre, email y listo. "
     "El mensaje ya viene escrito."),
    (None, "Además encontrarás", "Síntomas frecuentes, cómo se trabaja y los pasos de la terapia."),
]))

# 9 Contacto
s += [PageBreak()] + titulo(9, "Contacto directo", "¿Prefieres no usar el formulario? Al final de cada página tienes esto:")
s.append(pantalla("footer", [
    ("1", "silozpsicologia@gmail.com", "Escribe un email."),
    ("2", "620 450 696", "En el móvil, pulsa el número para llamar."),
    ("3", "Aviso Legal y Privacidad", "Cómo se cuidan tus datos."),
], img_w=70 * mm))

# 10 Si algo falla
s += [PageBreak()] + titulo(10, "Si algo falla", "Las dudas más normales y qué hacer.")
faq = [
    ("No me han contestado", "Mira la carpeta de spam. Si pasan más de 2 días, llama al 620 450 696."),
    ("Sale «Error al enviar el mensaje»", "Espera unos minutos y vuelve a probar. Si sigue, escribe a silozpsicologia@gmail.com."),
    ("El botón verde no hace nada", "Busca letras rojas en el formulario: falta algo (mira el paso 3)."),
    ("No encuentro el menú", "Son las tres rayas de arriba a la izquierda."),
    ("Sale «página no encontrada»", "Pulsa el círculo de arriba a la derecha para volver al inicio."),
]
s.append(pasos([("?", a, b) for a, b in faq], W, color=SAGE))
s.append(Spacer(1, 6))
s.append(caja([P("<b>Importante</b>", cell_b), P(
    "Esta web no es un servicio de urgencias. Si estás pasando por una crisis o piensas en hacerte daño, "
    "llama al <b>024</b> (gratis, 24 horas) o al <b>112</b>.", cell)], bg=CREAM, borde=RED))
s += [Spacer(1, 16), P("Gracias por confiar en Siloz Psicología.<br/>Dar el primer paso ya es parte del proceso.",
                       ParagraphStyle("end", parent=big, fontName="Serif-I", alignment=TA_CENTER, textColor=SAGE_DARK))]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                        topMargin=16 * mm, bottomMargin=20 * mm,
                        title="Guía fácil de la web — Siloz Psicología", author="Siloz Psicología",
                        subject="Cómo usar silozpsicologia.com paso a paso")
doc.build(s, onFirstPage=cover, onLaterPages=page)
print("OK ->", OUT)
