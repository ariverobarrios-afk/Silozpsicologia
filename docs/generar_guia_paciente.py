"""Genera docs/Guia-paciente-Siloz.pdf — instrucciones de uso de la web para pacientes.

Uso:  python3 docs/generar_guia_paciente.py
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "Guia-paciente-Siloz.pdf"
LOGO = ROOT / "client" / "public" / "images" / "logo-reloj-arena.png"

# --- Fuentes -------------------------------------------------------------
F = "/usr/share/fonts/truetype/crosextra/"
pdfmetrics.registerFont(TTFont("Serif", F + "Caladea-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Serif-B", F + "Caladea-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Serif-I", F + "Caladea-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Sans", F + "Carlito-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Sans-B", F + "Carlito-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Sans-I", F + "Carlito-Italic.ttf"))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans-I", boldItalic="Sans-B")
pdfmetrics.registerFontFamily("Serif", normal="Serif", bold="Serif-B", italic="Serif-I", boldItalic="Serif-B")

# --- Colores de marca (los mismos que usa la web) ------------------------
SAGE = colors.HexColor("#7A9B7F")
SAGE_DARK = colors.HexColor("#4A5D4F")
TEXT = colors.HexColor("#3F4A42")
MUTED = colors.HexColor("#6B7C6E")
CREAM = colors.HexColor("#F5F1E8")
SAGE_LIGHT = colors.HexColor("#E6EEE7")
LINE = colors.HexColor("#D9D2C3")

# --- Estilos ---------------------------------------------------------------
body = ParagraphStyle("body", fontName="Sans", fontSize=11, leading=15.5, textColor=TEXT, spaceAfter=6)
small = ParagraphStyle("small", parent=body, fontSize=9.5, leading=13, textColor=MUTED)
h1 = ParagraphStyle("h1", fontName="Serif-B", fontSize=21, leading=26, textColor=SAGE_DARK, spaceBefore=4, spaceAfter=4)
h2 = ParagraphStyle("h2", fontName="Serif-B", fontSize=14, leading=18, textColor=SAGE_DARK, spaceBefore=12, spaceAfter=5)
kicker = ParagraphStyle("kicker", fontName="Sans-B", fontSize=9, leading=12, textColor=SAGE, spaceAfter=2)
lead = ParagraphStyle("lead", parent=body, fontSize=12, leading=17, textColor=MUTED, spaceAfter=10)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=14, bulletIndent=2, spaceAfter=3)
cell = ParagraphStyle("cell", parent=body, fontSize=10, leading=13.5, spaceAfter=0)
cell_b = ParagraphStyle("cell_b", parent=cell, fontName="Sans-B", textColor=SAGE_DARK)
cell_h = ParagraphStyle("cell_h", parent=cell, fontName="Sans-B", textColor=colors.white)
step_n = ParagraphStyle("step_n", fontName="Serif-B", fontSize=16, leading=18, textColor=colors.white, alignment=TA_CENTER)

W = A4[0] - 2 * 20 * mm  # ancho útil


def P(t, s=body):
    return Paragraph(t, s)


def bullets(items):
    return [Paragraph(i, bullet, bulletText="•") for i in items]


def section(num, title, intro=None):
    out = [P(f"{num:02d}", kicker), P(title, h1)]
    if intro:
        out.append(P(intro, lead))
    return out


def box(flowables, bg=CREAM, border=None):
    t = Table([[flowables]], colWidths=[W])
    st = [
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    if border:
        st.append(("LINEBEFORE", (0, 0), (0, -1), 3, border))
    t.setStyle(TableStyle(st))
    t.spaceBefore, t.spaceAfter = 6, 6
    return t


def tip(text, label="Consejo"):
    return box([P(f"<b>{label}.</b> {text}", cell)], bg=SAGE_LIGHT, border=SAGE)


def steps(rows):
    """rows: list of (titulo, texto). Pasos numerados con círculo verde."""
    data = [[P(str(i + 1), step_n), [P(f"<b>{t}</b>", cell_b), P(d, cell)]] for i, (t, d) in enumerate(rows)]
    t = Table(data, colWidths=[11 * mm, W - 11 * mm])
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (1, 0), (1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for i in range(len(rows)):
        st += [("BACKGROUND", (0, i), (0, i), SAGE)]
        if i < len(rows) - 1:
            st.append(("LINEBELOW", (1, i), (1, i), 0.5, LINE))
    t.setStyle(TableStyle(st))
    return t


def table(header, rows, widths):
    data = [[P(h, cell_h) for h in header]] + [
        [P(c, cell_b if j == 0 else cell) for j, c in enumerate(r)] for r in rows
    ]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [
        ("BACKGROUND", (0, 0), (-1, 0), SAGE_DARK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            st.append(("BACKGROUND", (0, i), (-1, i), CREAM))
    t.setStyle(TableStyle(st))
    return t


# --- Página: portada y pie ----------------------------------------------
def cover(c, doc):
    w, h = A4
    c.saveState()
    c.setFillColor(CREAM)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setFillColor(SAGE)
    c.rect(0, 0, w, 12 * mm, stroke=0, fill=1)
    c.drawImage(str(LOGO), w / 2 - 32 * mm, h - 118 * mm, 64 * mm, 64 * mm, mask="auto")
    c.setFillColor(SAGE_DARK)
    c.setFont("Serif-B", 32)
    c.drawCentredString(w / 2, h - 138 * mm, "Siloz Psicología")
    c.setFillColor(SAGE)
    c.setFont("Sans-B", 11)
    c.drawCentredString(w / 2, h - 148 * mm, "PSICOLOGÍA ONLINE INTEGRADORA")
    c.setStrokeColor(SAGE)
    c.setLineWidth(0.8)
    c.line(w / 2 - 25 * mm, h - 158 * mm, w / 2 + 25 * mm, h - 158 * mm)
    c.setFillColor(TEXT)
    c.setFont("Serif", 22)
    c.drawCentredString(w / 2, h - 175 * mm, "Guía para pacientes")
    c.setFillColor(MUTED)
    c.setFont("Sans", 13)
    c.drawCentredString(w / 2, h - 185 * mm, "Cómo usar la web y todo lo que puedes hacer en ella")
    c.setFont("Sans-B", 13)
    c.setFillColor(SAGE_DARK)
    c.drawCentredString(w / 2, h - 205 * mm, "silozpsicologia.com")
    c.setFont("Sans", 10)
    c.setFillColor(MUTED)
    c.drawCentredString(w / 2, 22 * mm, "Silvia López · Psicóloga General Sanitaria")
    c.restoreState()


def page(c, doc):
    w, h = A4
    c.saveState()
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(20 * mm, h - 14 * mm, w - 20 * mm, h - 14 * mm)
    c.setFont("Sans", 8.5)
    c.setFillColor(MUTED)
    c.drawString(20 * mm, h - 11.5 * mm, "Siloz Psicología · Guía para pacientes")
    c.drawRightString(w - 20 * mm, h - 11.5 * mm, "silozpsicologia.com")
    c.line(20 * mm, 14 * mm, w - 20 * mm, 14 * mm)
    c.drawString(20 * mm, 9.5 * mm, "silozpsicologia@gmail.com · 620 450 696")
    c.drawRightString(w - 20 * mm, 9.5 * mm, f"{doc.page - 1}")
    c.restoreState()


# --- Contenido -----------------------------------------------------------
s = [PageBreak()]

# Índice / bienvenida
s += [P("Bienvenida", h1), P(
    "Esta guía te acompaña paso a paso por la web de Siloz Psicología para que sepas "
    "qué puedes encontrar en ella, cómo pedir tu primera cita y dónde acudir si tienes dudas. "
    "No necesitas crear ninguna cuenta ni instalar nada: todo funciona desde el navegador del "
    "móvil, la tablet o el ordenador.", lead)]
toc = [
    ("01", "Moverte por la web", "La barra superior, el menú y el pie de página."),
    ("02", "La página de inicio", "Qué hay en cada sección."),
    ("03", "Pedir tu sesión de valoración", "El formulario, paso a paso."),
    ("04", "Tarifas", "Precios y duración de cada sesión."),
    ("05", "Cómo es el proceso terapéutico", "Qué ocurre después de contactar."),
    ("06", "Páginas de ansiedad y depresión", "Información específica y formulario rápido."),
    ("07", "Blog", "Artículos para entenderte mejor."),
    ("08", "Recursos descargables", "Guías gratuitas en PDF."),
    ("09", "Cookies y privacidad", "Qué eliges y cómo se cuidan tus datos."),
    ("10", "Contacto y solución de problemas", "Si algo no funciona."),
]
t = Table([[P(n, ParagraphStyle("n", parent=cell_b, textColor=SAGE)), P(f"<b>{a}</b>", cell_b), P(b, cell)] for n, a, b in toc],
          colWidths=[12 * mm, 68 * mm, W - 80 * mm])
t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 6),
                       ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
s += [Spacer(1, 4), P("Contenido", h2), t, Spacer(1, 14)]
s.append(box([
    P("<b>En resumen</b>", cell_b),
    P("Terapia psicológica <b>100% online</b> y confidencial con Silvia López, psicóloga general sanitaria colegiada. "
      "El primer paso es siempre una <b>sesión de valoración inicial</b> (25 €, 60 min), que se solicita "
      "rellenando el formulario de la web. Normalmente recibirás respuesta en menos de 24 horas.", cell),
]))

# 01 Navegación
s += [PageBreak()] + section(1, "Moverte por la web",
    "En la parte superior de todas las páginas verás siempre una barra fija con tres elementos.")
s.append(table(
    ["Elemento", "Dónde está", "Para qué sirve"],
    [
        ["Menú (tres rayas)", "A la izquierda", "Abre la lista de secciones. Pulsa la X para cerrarlo."],
        ["Solicita tu cita", "En el centro (botón verde)", "Abre directamente el formulario para pedir tu sesión de valoración, estés en la página que estés."],
        ["Logo Siloz Psicología", "A la derecha", "Te lleva de vuelta al principio de la página de inicio."],
    ], [38 * mm, 42 * mm, W - 80 * mm]))
s += [P("Opciones del menú", h2), P("El menú tiene dos grupos. Los cuatro primeros te desplazan a una sección de la página de inicio; los dos últimos abren una página nueva:")]
s += bullets([
    "<b>Inicio</b> — vuelve a la parte superior.",
    "<b>Sobre mí</b> — conoce a Silvia y su forma de trabajar.",
    "<b>Preguntas frecuentes</b> — dudas habituales antes de empezar terapia.",
    "<b>Tarifas</b> — precios de cada tipo de sesión.",
    "<b>Blog</b> — artículos sobre bienestar emocional.",
    "<b>Recursos</b> — guías gratuitas para descargar.",
])
s += [P("El pie de página", h2), P(
    "Al final de cada página encontrarás enlaces rápidos (Inicio, Sobre mí, Tarifas, Contacto), "
    "accesos al Blog y a Recursos, los datos de contacto directo (email y teléfono) y el enlace a "
    "<b>Aviso Legal y Privacidad</b>.")]
s.append(tip("En el móvil puedes pulsar sobre el número de teléfono del pie de página para llamar directamente."))

# 02 Inicio
s += [PageBreak()] + section(2, "La página de inicio",
    "Es la página principal. Si la recorres de arriba abajo encontrarás, en este orden:")
s.append(table(
    ["Sección", "Qué encontrarás"],
    [
        ["Portada", "Presentación de la terapia online, la foto de Silvia y el botón <i>Reserva tu sesión de valoración</i>. "
                    "Debajo, tres garantías: psicóloga colegiada, sesiones online confidenciales y enfoque personalizado."],
        ["Conócenos", "Qué es Siloz Psicología: un espacio de escucha, sin prejuicios ni expectativas."],
        ["¿Cómo es la terapia conmigo?", "Silvia se presenta y explica su mirada terapéutica: entender lo que hay detrás del síntoma y trabajarlo desde la raíz."],
        ["¿En qué puedo acompañarte?", "Áreas de trabajo: ansiedad, depresión, dificultades de pareja, dificultades familiares, autoestima, dolor crónico, gestión emocional, adicciones y trauma."],
        ["Cómo funciona el proceso", "Los tres pasos de la terapia (ver apartado 05)."],
        ["Preguntas frecuentes", "Pulsa sobre cada pregunta para desplegar la respuesta; vuelve a pulsar para cerrarla."],
        ["Tarifas", "Las cuatro modalidades de sesión con su precio y un botón para reservar (ver apartado 04)."],
        ["Lo que dicen nuestros pacientes", "Opiniones reales de pacientes y un enlace para ver todas las reseñas en Google."],
        ["¿Para quién es este espacio?", "A quién va dirigida la terapia: personas que quieren comprometerse con un proceso, no buscar consejos rápidos."],
        ["Solicita una sesión de valoración", "El formulario de contacto completo (ver apartado 03)."],
    ], [50 * mm, W - 50 * mm]))
s += [Spacer(1, 8), P("Preguntas frecuentes que se responden en la web", h2)]
s += bullets([
    "¿Cómo sé si necesito ir al psicólogo?",
    "¿En qué consiste un proceso de terapia?",
    "¿Cómo encuentro un psicólogo adecuado para mí?",
    "¿La terapia online es para todo el mundo?",
    "¿Y si ya he ido a terapia antes y no funcionó?",
])

# 03 Formulario
s += [PageBreak()] + section(3, "Pedir tu sesión de valoración",
    "Es la forma principal de empezar. Puedes abrir el formulario desde cualquiera de estos sitios:")
s += bullets([
    "El botón verde <b>Solicita tu cita</b> de la barra superior (en cualquier página).",
    "Cualquier botón <b>Reserva tu sesión de valoración</b> de la página de inicio.",
    "Los botones de cada tarifa. Si eliges <i>Terapia de pareja / familiar</i>, el formulario ya queda marcado con ese tipo de sesión.",
    "La sección <b>Solicita una sesión de valoración</b>, al final de la página de inicio.",
])
s += [P("Paso a paso", h2), steps([
    ("Escribe tu nombre completo", "Obligatorio."),
    ("Escribe tu email", "Obligatorio. Revisa que esté bien escrito: es por donde recibirás la respuesta."),
    ("Teléfono", "Opcional. Si prefieres que te llamen o te escriban por teléfono, añádelo."),
    ("¿Qué te gustaría trabajar en terapia?", "Opcional. Por ejemplo: ansiedad, autoestima, relaciones…"),
    ("¿Has realizado terapia anteriormente?", "Opcional. Elige Sí o No en el desplegable."),
    ("¿Buscas iniciar un proceso terapéutico?", "Opcional. Elige Sí o No."),
    ("Mensaje", "Obligatorio, mínimo 10 caracteres. Cuenta brevemente tu situación; no hace falta entrar en detalles."),
    ("Pulsa «Solicitar sesión de valoración»", "Verás «Enviando…» unos segundos. Después se abrirá una página de agradecimiento."),
])]
s += [P("¿Y después?", h2), P(
    "Si todo ha ido bien verás la página <b>«¡Gracias!»</b>, que confirma que tu mensaje ha llegado. "
    "Silvia se pondrá en contacto contigo <b>lo antes posible</b> (normalmente en menos de 24 horas) para concretar "
    "el día y la hora de tu sesión de valoración. Desde esa página puedes volver al inicio o ir al blog.")]
s.append(KeepTogether([tip(
    "Si algún campo obligatorio está vacío o mal escrito, aparecerá un aviso en rojo justo debajo "
    "(por ejemplo «Email inválido» o «El mensaje debe tener al menos 10 caracteres»). Corrígelo y vuelve a pulsar el botón.",
    "Si aparece un aviso en rojo"), Spacer(1, 6), tip(
    "Si al enviar aparece el mensaje «Error al enviar el mensaje», tus datos no se han enviado. "
    "Inténtalo de nuevo pasados unos minutos o escribe directamente a silozpsicologia@gmail.com.",
    "Si no se envía")]))

# 04 Tarifas
s += [PageBreak()] + section(4, "Tarifas",
    "Todas las sesiones son online. Puedes consultarlas en el menú → <b>Tarifas</b>.")
s.append(table(
    ["Modalidad", "Precio", "Duración", "Para qué es"],
    [
        ["Sesión de valoración inicial", "25 €", "60 min", "Primera sesión: comprender tu situación, explorar tus dificultades y definir el enfoque terapéutico."],
        ["Terapia individual", "55 €", "60 min", "Trabajar en profundidad lo que está afectando a tu bienestar."],
        ["Bono 5 sesiones", "250 €", "5 × 60 min", "Para quien desea comprometerse con un proceso continuado y con seguimiento regular."],
        ["Terapia de pareja / familiar", "70 €", "75 min", "Dinámicas relacionales, comunicación y conflictos en la pareja o la familia."],
    ], [42 * mm, 18 * mm, 22 * mm, W - 82 * mm]))
s += [Spacer(1, 10), tip("Cada tarifa tiene su propio botón de reserva. Todos abren el mismo formulario; "
                          "el primer paso siempre es la sesión de valoración inicial.")]

# 05 Proceso
s += [Spacer(1, 6)] + section(5, "Cómo es el proceso terapéutico",
    "Así se explica en la web lo que ocurre una vez que decides empezar:")
s.append(steps([
    ("Sesión de valoración inicial", "Comprendemos tu situación, tu historia personal y los aspectos que te gustaría trabajar. "
     "También sirve para que conozcas el formato online y decidas con información si es para ti."),
    ("Evaluación terapéutica", "Exploramos patrones emocionales, relacionales y personales que están influyendo en tu bienestar."),
    ("Proceso de intervención", "Iniciamos el trabajo terapéutico orientado a generar cambios sostenidos en tu vida."),
]))

# 06 Ansiedad / Depresión
s += [PageBreak()] + section(6, "Páginas de ansiedad y depresión",
    "La web tiene dos páginas dedicadas, pensadas para quien llega buscando ayuda con un tema concreto:")
s += bullets([
    "<b>silozpsicologia.com/ansiedad</b>",
    "<b>silozpsicologia.com/depresion</b>",
])
s.append(P("Cada una incluye:"))
s += bullets([
    "Una lista de <b>síntomas frecuentes</b> para ayudarte a reconocer lo que te pasa.",
    "Cómo se trabaja desde la terapia integradora y en un espacio seguro.",
    "El <b>proceso en 4 pasos</b>: valoración inicial, evaluación y plan personalizado, intervención terapéutica, y seguimiento y prevención.",
    "Un testimonio de un paciente.",
    "Un <b>formulario corto</b> (nombre, email, teléfono opcional y mensaje opcional). El mensaje ya viene escrito, "
    "así que puedes enviarlo tal cual o adaptarlo.",
    "Un botón <b>Volver al inicio</b> en la esquina superior.",
])
s.append(tip("Estas páginas no aparecen en el menú. Puedes llegar a ellas a través de un enlace o escribiendo la dirección en el navegador."))

# 07 Blog
s += [Spacer(1, 4)] + section(7, "Blog",
    "Artículos escritos por Silvia para entender mejor lo que sientes, con una mirada desde el cuerpo y el sistema nervioso. "
    "Entra desde el menú → <b>Blog</b>.")
s += bullets([
    "Cada tarjeta muestra la <b>categoría</b>, el título y un pequeño resumen. Pulsa <b>Leer más</b> para abrir el artículo.",
    "Al final de cada artículo verás <b>artículos relacionados</b> de la misma categoría.",
    "Usa <b>Volver al Blog</b> para regresar a la lista.",
])
s.append(P("Artículos disponibles ahora mismo", h2))
s.append(table(
    ["Categoría", "Artículo"],
    [
        ["Salud Mental", "Cuando descansar no descansa: el cansancio que no se va aunque pares"],
        ["Ansiedad", "Ansiedad sin motivo aparente: cuando el cuerpo no consigue bajar la guardia"],
        ["Gestión Emocional", "Cuando me siento apagado y no sé por qué"],
        ["Gestión Emocional", "La frustración y la sensación constante de estar fallando: una lectura desde el cuerpo"],
    ], [40 * mm, W - 40 * mm]))

# 08 Recursos
s += [PageBreak()] + section(8, "Recursos descargables",
    "Materiales gratuitos para trabajar entre sesiones o por tu cuenta. Entra desde el menú → <b>Recursos</b>.")
s += bullets([
    "Pulsa el botón de descarga del recurso que te interese.",
    "El archivo se abre en una <b>pestaña nueva</b>; desde ahí puedes leerlo, guardarlo o imprimirlo.",
])
s.append(box([
    P("<b>Disponible ahora: «La ventana de tolerancia»</b> (PDF)", cell_b),
    P("Entendiendo qué nos pasa cuando nos desbordamos o nos apagamos. Una guía para entenderte, no para corregirte. "
      "Categorías: Ansiedad · Guía práctica · Acompañamiento.", cell),
]))
s.append(tip("Si en el móvil no ves el PDF, comprueba que el navegador no ha bloqueado la ventana emergente "
             "o búscalo en tu carpeta de Descargas."))

# 09 Cookies y privacidad
s += [Spacer(1, 4)] + section(9, "Cookies y privacidad",
    "La primera vez que entras en la web aparece un aviso de cookies en la parte inferior de la pantalla.")
s.append(table(
    ["Opción", "Qué significa"],
    [
        ["Aceptar todas", "Se usan las cookies técnicas y además las de análisis y publicidad de Google, que ayudan a mejorar la web."],
        ["Solo esenciales", "Solo se usan las cookies técnicas necesarias para que la web funcione. Puedes usar toda la web igual."],
    ], [40 * mm, W - 40 * mm]))
s += [Spacer(1, 6)]
s += bullets([
    "Tu elección se recuerda, así que el aviso no vuelve a salir. Si borras los datos del navegador, volverá a aparecer.",
    "La información completa está en <b>Aviso Legal y Privacidad</b> (enlace en el pie de página y en el propio aviso).",
    "Los datos que envías en el formulario solo se usan para responder a tu solicitud y organizar tu cita. "
    "Las sesiones son <b>confidenciales</b>.",
])

# 10 Contacto y problemas
s += [PageBreak()] + section(10, "Contacto y solución de problemas",
    "Si prefieres no usar el formulario, o algo no funciona, puedes contactar directamente:")
s.append(table(
    ["Canal", "Dato"],
    [
        ["Email", "silozpsicologia@gmail.com"],
        ["Teléfono", "620 450 696"],
        ["Web", "silozpsicologia.com"],
    ], [40 * mm, W - 40 * mm]))
s += [P("Problemas frecuentes", h2)]
s.append(table(
    ["Si te pasa esto…", "Prueba esto"],
    [
        ["Envié el formulario y no he recibido respuesta", "Revisa la carpeta de <b>spam</b> o «Promociones». Comprueba que escribiste bien tu email. Si han pasado más de 48 h, escribe o llama directamente."],
        ["Aparece «Error al enviar el mensaje»", "Comprueba tu conexión e inténtalo de nuevo en unos minutos. Si persiste, escribe al email de contacto."],
        ["El botón de enviar no hace nada", "Busca avisos en rojo debajo de los campos: falta algún dato obligatorio o el mensaje es demasiado corto."],
        ["No encuentro el menú", "Es el icono de tres rayas en la esquina superior izquierda."],
        ["Escribí una dirección y sale «página no encontrada»", "Puede que la dirección tenga una errata. Vuelve al inicio desde el logo o escribe silozpsicologia.com."],
        ["El aviso de cookies tapa la pantalla", "Elige una de las dos opciones y desaparecerá."],
    ], [62 * mm, W - 62 * mm]))
s += [Spacer(1, 12), box([
    P("<b>Importante</b>", cell_b),
    P("La web y el formulario no son un servicio de urgencias. Si estás pasando por una crisis o tienes pensamientos "
      "de hacerte daño, llama al <b>024</b> (Línea de atención a la conducta suicida, gratuita y 24 h) o al <b>112</b>.", cell),
], bg=CREAM, border=SAGE_DARK)]
s += [Spacer(1, 18), P("Gracias por confiar en Siloz Psicología. Dar el primer paso ya es parte del proceso. 🌿".replace(" 🌿", ""),
                       ParagraphStyle("end", parent=lead, fontName="Serif-I", alignment=TA_CENTER, textColor=SAGE_DARK))]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                        topMargin=22 * mm, bottomMargin=22 * mm,
                        title="Guía para pacientes — Siloz Psicología", author="Siloz Psicología",
                        subject="Cómo usar la web silozpsicologia.com")
doc.build(s, onFirstPage=cover, onLaterPages=page)
print("OK ->", OUT)
