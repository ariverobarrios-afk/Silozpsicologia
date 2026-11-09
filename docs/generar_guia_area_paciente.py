"""Genera docs/Guia-area-paciente-Siloz.pdf — guía visual del ÁREA PRIVADA del paciente.

Las capturas (docs/img-area/) se hicieron sobre la app real con un paciente
inventado («Laura García»): no contienen datos de pacientes reales.
Uso:  python3 docs/generar_guia_area_paciente.py
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
    Flowable, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "Guia-area-paciente-Siloz.pdf"
IMG = ROOT / "docs" / "img-area"
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
RED = colors.HexColor("#D9480F")
AMBER = colors.HexColor("#FDF3D6")

body = ParagraphStyle("body", fontName="Sans", fontSize=14, leading=19, textColor=TEXT, spaceAfter=8)
big = ParagraphStyle("big", parent=body, fontSize=16, leading=22)
h1 = ParagraphStyle("h1", fontName="Serif-B", fontSize=27, leading=32, textColor=SAGE_DARK, spaceAfter=4)
h2 = ParagraphStyle("h2", fontName="Serif-B", fontSize=17, leading=21, textColor=SAGE_DARK, spaceBefore=8, spaceAfter=6)
sub = ParagraphStyle("sub", parent=body, fontSize=15, leading=20, textColor=MUTED, spaceAfter=12)
kicker = ParagraphStyle("kicker", fontName="Sans-B", fontSize=11, leading=14, textColor=SAGE, spaceAfter=2)
step_t = ParagraphStyle("step_t", parent=body, fontName="Sans-B", fontSize=15, leading=19, textColor=SAGE_DARK, spaceAfter=1)
step_d = ParagraphStyle("step_d", parent=body, fontSize=13.5, leading=18, spaceAfter=0)
cell = ParagraphStyle("cell", parent=body, fontSize=13.5, leading=18, spaceAfter=0)
cell_b = ParagraphStyle("cell_b", parent=cell, fontName="Sans-B", textColor=SAGE_DARK)

W = A4[0] - 2 * 18 * mm


class Badge(Flowable):
    def __init__(self, text, color=RED, d=9 * mm):
        super().__init__()
        self.text, self.color, self.d = text, color, d
        self.width = self.height = d

    def draw(self):
        c, r = self.canv, self.d / 2
        c.setFillColor(self.color)
        c.circle(r, r, r, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Badge", 13 if len(self.text) == 1 else 10)
        c.drawCentredString(r, r - 4.5, self.text)


def P(t, s=body):
    return Paragraph(t, s)


def foto(name, width, max_h=None):
    path = IMG / f"{name}.jpg"
    w, h = PILImage.open(path).size
    if max_h and width * h / w > max_h:
        width = max_h * w / h
    return Image(str(path), width=width, height=width * h / w)


def pasos(items, width, color=RED):
    rows = []
    for n, t, d in items:
        txt = [P(t, step_t)] + ([P(d, step_d)] if d else [])
        rows.append([Badge(n, color) if n else "", txt])
    t = Table(rows, colWidths=[12 * mm, width - 12 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
    ]))
    return t


def caja(contenido, bg=SAGE_LIGHT, borde=SAGE, width=W):
    if not isinstance(contenido, list):
        contenido = [contenido]
    t = Table([[contenido]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 4, borde),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    t.spaceBefore, t.spaceAfter = 6, 6
    return t


def truco(texto, width=W, label="Truco"):
    return caja(P(f"<b>{label}:</b> {texto}", cell), width=width)


def ojo(texto, width=W):
    return caja(P(f"<b>Importante:</b> {texto}", cell), bg=AMBER, borde=RED, width=width)


def titulo(num, t, s=None):
    out = [P(num if isinstance(num, str) else f"PASO {num}", kicker), P(t, h1)]
    if s:
        out.append(P(s, sub))
    return out


def pantalla(img, items, img_w=72 * mm, notas=(), color=RED, max_h=None):
    """Foto a la izquierda; pasos y notas a la derecha. notas: lista de flowables-fábrica (width -> flowable)."""
    gap = 8 * mm
    rw = W - img_w - gap
    right = [pasos(items, rw, color)] + [n(rw) for n in notas]
    t = Table([[foto(img, img_w, max_h), right]], colWidths=[img_w + gap, rw])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


T = lambda text: (lambda w: truco(text, w))  # noqa: E731
O = lambda text: (lambda w: ojo(text, w))  # noqa: E731


def tabla(rows, widths):
    t = Table([[P(a, cell_b), P(b, cell)] for a, b in rows], colWidths=widths)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return t


def cover(c, doc):
    w, h = A4
    c.saveState()
    c.setFillColor(CREAM); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setFillColor(SAGE); c.rect(0, 0, w, 12 * mm, stroke=0, fill=1)
    c.drawImage(str(LOGO), w / 2 - 30 * mm, h - 110 * mm, 60 * mm, 60 * mm, mask="auto")
    c.setFillColor(SAGE_DARK); c.setFont("Serif-B", 34)
    c.drawCentredString(w / 2, h - 130 * mm, "Siloz Psicología")
    c.setFillColor(TEXT); c.setFont("Serif", 26)
    c.drawCentredString(w / 2, h - 152 * mm, "Tu área privada")
    c.setFillColor(MUTED); c.setFont("Sans", 16)
    c.drawCentredString(w / 2, h - 164 * mm, "Citas, documentos y facturas · Guía fácil con fotos")
    c.setFillColor(SAGE_DARK); c.setFont("Sans-B", 18)
    c.drawCentredString(w / 2, h - 188 * mm, "silozpsicologia.com/acceso")
    c.setFont("Sans-I", 10); c.setFillColor(MUTED)
    c.drawCentredString(w / 2, 26 * mm, "Las fotos de esta guía usan una paciente de ejemplo («Laura»). Tus datos serán los tuyos.")
    c.setFont("Sans", 11)
    c.drawCentredString(w / 2, 19 * mm, "Silvia López · Psicóloga General Sanitaria")
    c.restoreState()


def page(c, doc):
    w, h = A4
    c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.5)
    c.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
    c.setFont("Sans", 10); c.setFillColor(MUTED)
    c.drawString(18 * mm, 9 * mm, "Siloz Psicología · Tu área privada · silozpsicologia@gmail.com · 620 450 696")
    c.drawRightString(w - 18 * mm, 9 * mm, f"Página {doc.page - 1}")
    c.restoreState()


# --- Contenido ---------------------------------------------------------------
s = [PageBreak()]

s += [P("ANTES DE EMPEZAR", kicker), P("¿Qué es tu área privada?", h1),
      P("Es tu espacio personal dentro de la web de Siloz Psicología. Solo entras tú, con tu email y tu contraseña.", sub)]
s.append(pasos([
    ("✓", "Reservar y cancelar tus citas", "En los huecos que Silvia abre en su agenda."),
    ("✓", "Ver tus próximas citas y tu historial", "Con el estado de cada una y si está pagada."),
    ("✓", "Firmar el consentimiento", "Desde el móvil, con el dedo. Sin imprimir nada."),
    ("✓", "Descargar tus documentos y facturas", "Siempre disponibles, cuando los necesites."),
    ("✓", "Leer las «Claves de mi proceso»", "Lo importante de tus sesiones, revisado por Silvia."),
    ("✓", "Ver tus citas en el calendario del móvil", "Google Calendar, iPhone u Outlook."),
], W, color=SAGE))
s.append(caja([P("<b>En esta guía:</b>", cell_b), P(
    "1. Entrar la primera vez · 2. Entrar las demás veces · 3. Si olvidas la contraseña · 4. Firmar el consentimiento · "
    "5. Tu pantalla principal · 6. Reservar cita · 7. Tus próximas citas y cancelar · 8. Historial y pagos · "
    "9. Citas en tu calendario · 10. Claves de mi proceso · 11. Documentos y facturas · 12. Tenerla como app · "
    "13. Privacidad · 14. Si algo falla", cell)], bg=CREAM, borde=SAGE_DARK))
s.append(caja(P("<b>Cómo leer las fotos:</b> los <font color='#D9480F'><b>recuadros rojos con un número</b></font> "
                "señalan dónde tienes que pulsar. El número coincide con la explicación de al lado.", cell)))

# 1 Primera vez
s += [PageBreak()] + titulo(1, "Entrar por primera vez", "No tienes que registrarte: Silvia te da de alta.")
s.append(pasos([
    ("✓", "Te llega un email", "Asunto: <b>«Tu acceso al área privada de Siloz Psicología»</b>. Si no lo ves, mira en spam."),
    ("✓", "Pulsa «Crear mi contraseña»", "Se abre la web en la pantalla de la foto."),
], W, color=SAGE))
s.append(pantalla("nueva", [
    ("1", "Escribe una contraseña", "Mínimo 8 letras o números. Que solo sepas tú."),
    ("2", "Repítela", "Tiene que ser exactamente igual."),
    ("3", "Guardar y entrar", "Ya estás dentro de tu área."),
], notas=[T("Si pone «El enlace no es válido o ha caducado», no pasa nada: pide uno nuevo con "
            "«¿Has olvidado tu contraseña?» (paso 3).")]))

# 2 Entrar
s += [PageBreak()] + titulo(2, "Entrar las demás veces", "Desde la web: menú → <b>ÁREA PRIVADA</b>. O directamente en <b>silozpsicologia.com/acceso</b>.")
s.append(pantalla("entrada", [
    ("1", "ÁREA PRIVADA", "Está al final del menú de la web (las tres rayas de arriba a la izquierda)."),
], img_w=64 * mm))
s.append(Spacer(1, 8))
s.append(pantalla("login", [
    ("1", "Tu email", "El mismo en el que recibiste la invitación."),
    ("2", "Tu contraseña", None),
    ("3", "Entrar", None),
    ("4", "¿Has olvidado tu contraseña?", "Mira el paso 3."),
], img_w=64 * mm, notas=[T("Si sale «Email o contraseña incorrectos», revisa que no haya espacios ni mayúsculas de más.")]))

# 3 Olvidé contraseña
s += [PageBreak()] + titulo(3, "Si olvidas la contraseña", "En la pantalla de entrar, pulsa <b>¿Has olvidado tu contraseña?</b>")
s.append(pantalla("reset", [
    ("1", "Escribe tu email", None),
    ("2", "Enviar enlace", None),
    ("3", "Mira tu correo", "Te llega un email «Crear una nueva contraseña». Pulsa el enlace y elige una nueva, igual que en el paso 1."),
], notas=[T("Por seguridad, el mensaje es el mismo aunque el email no esté dado de alta. "
            "Si no te llega nada en unos minutos, revisa spam o escribe a Silvia.")]))

# 4 Consentimiento
s += [PageBreak()] + titulo(4, "Firmar el consentimiento", "Es lo primero que te pedirá tu área. Se hace una sola vez y tardas unos minutos.")
s.append(pantalla("pendiente", [
    ("1", "Firmar ahora", "Pulsa el botón del aviso amarillo."),
    ("2", "El punto naranja", "En «Documentos» te recuerda que tienes algo pendiente."),
], notas=[T("Puedes reservar citas aunque aún no hayas firmado, pero conviene hacerlo cuanto antes.")]))

s += [PageBreak()] + titulo("PASO 4 · CONTINUACIÓN", "Revisa tus datos", "Ya vienen rellenos con lo que tiene Silvia. Completa lo que falte (se marca en color).")
s.append(pantalla("firma_datos", [
    ("1", "DNI o NIE", "Con su letra, por ejemplo 12345678Z."),
    ("2", "Fecha de nacimiento", "Toca la casilla y elige el día."),
    ("3", "Email (no se puede cambiar)", "Es el de tu cuenta. Ahí te llegará la copia firmada."),
], img_w=70 * mm, notas=[O("Si eres menor de 18 años no puedes firmar aquí. La web te avisará: habla con Silvia.")]))

s += [PageBreak()] + titulo("PASO 4 · CONTINUACIÓN", "Lee y marca las tres casillas",
                            "Hay tres bloques: <b>A</b> protección de datos, <b>B</b> normas del servicio y <b>C</b> derecho de desistimiento.")
s.append(pantalla("firma_bloque", [
    ("1", "La casilla de cada bloque", "Se activa cuando bajas hasta el final del texto, o a los 10 segundos. Márcala."),
    (None, "Repite con los bloques B y C", "Cuando un bloque está aceptado aparece una marca verde arriba a la derecha."),
], img_w=70 * mm))

s += [PageBreak()] + titulo("PASO 4 · CONTINUACIÓN", "Firma con el dedo", "Al final de la página está el recuadro de la firma.")
s.append(pantalla("firma_firma", [
    ("1", "Firma dentro del recuadro", "Con el dedo en el móvil, o con el ratón en el ordenador."),
    ("2", "Borrar", "Si no te gusta cómo ha quedado, bórrala y repite."),
    ("3", "Firmar", "Se activa cuando todo está completo. Si falta algo, la frase de encima te dice qué."),
], img_w=74 * mm))
s.append(Spacer(1, 8))
s.append(pantalla("firma_hecha", [
    ("✓", "¡Documento firmado!", "Te llega una copia en PDF a tu email."),
    ("1", "Descargar PDF", "Para guardarlo ya, si quieres."),
    ("2", "Volver a mi área", "Tu documento queda siempre en «Documentos»."),
], img_w=74 * mm))

# 5 Pantalla principal
s += [PageBreak()] + titulo(5, "Tu pantalla principal", "Cada vez que entras verás esto. Arriba pone «Hola» y tu nombre.")
s.append(pantalla("area", [
    ("1", "Citas", "Reservar, tus próximas citas, el historial y el calendario."),
    ("2", "Documentos", "Tu consentimiento firmado y tus facturas."),
    ("3", "Gestión de citas", "Dentro de «Citas»: todo lo de reservar y cancelar."),
    ("4", "Claves de mi proceso", "Dentro de «Citas»: lo importante de tus sesiones."),
    ("5", "Salir", "Para cerrar tu sesión. Hazlo siempre en un ordenador compartido."),
], notas=[T("Si tienes un <b>bono</b>, verás un recuadro con las sesiones que te quedan (en la foto: «Te queda 1 sesión de 5»).")]))

# 6 Reservar
s += [PageBreak()] + titulo(6, "Reservar una cita", "En <b>Citas → Gestión de citas → Reservar cita</b> salen los huecos libres de Silvia, por días.")
s.append(pantalla("reservar", [
    ("1", "Pulsa la hora que quieras", "Cada botón es un hueco libre de 50 minutos."),
    ("2", "«Ya tienes cita esta semana»", "Esos días salen en gris: solo se puede reservar <b>una cita por semana</b> (de lunes a domingo)."),
    (None, "Las normas", "• Se reserva con <b>24 horas</b> de antelación como mínimo.<br/>"
     "• Se ven los huecos de las <b>próximas 6 semanas</b>.<br/>• Las horas son las de <b>Madrid</b> (importante si vives fuera)."),
], img_w=64 * mm, notas=[T("¿No sale ningún hueco o necesitas otra cita esa semana? Escribe a Silvia.")]))

s += [PageBreak()] + titulo("PASO 6 · CONTINUACIÓN", "Confirma la reserva", "Al pulsar una hora se abre este resumen.")
s.append(pantalla("confirmar", [
    (None, "Revisa fecha y hora", "Arriba ves el día, la hora, la duración y la psicóloga."),
    ("1", "Comentario (opcional)", "Algo que quieras decirle a Silvia. Máximo 300 letras. Solo lo ve ella."),
    ("2", "Confirmar reserva", "¡Hecho! Te llega un email de confirmación y Silvia recibe un aviso."),
], notas=[T("¿Te has equivocado de hora? Pulsa «Volver» y elige otra. No se reserva nada hasta confirmar."),
          T("Si otra persona ha cogido ese hueco justo antes, la web te avisará. Elige otro.", )]))

# 7 Próximas citas y cancelar
s += [PageBreak()] + titulo(7, "Tus próximas citas", "Debajo de «Reservar cita» están las que tienes programadas.")
s.append(pantalla("proximas", [
    ("1", "Cancelar cita", "Solo sale en las citas que <b>reservaste tú</b> desde el área. Las que te dio Silvia directamente, se cambian hablando con ella."),
    ("2", "Pendiente · 55 €", "Esa sesión está pendiente de pago."),
], img_w=70 * mm))
s.append(P("Qué significa cada etiqueta", h2))
s.append(tabla([
    ("Programada", "La cita está confirmada y aún no ha pasado."),
    ("Realizada", "La sesión ya se hizo."),
    ("Cancelada", "La cita se anuló."),
    ("Primera sesión", "Tu sesión de valoración inicial."),
    ("Bono", "La sesión se descuenta de tu bono."),
    ("Pagada · 55 €", "Ya está pagada."),
    ("Pendiente · 55 €", "Falta pagarla."),
], [42 * mm, W - 42 * mm]))

s += [PageBreak()] + titulo("PASO 7 · CONTINUACIÓN", "Cancelar una cita", "Pulsa <b>Cancelar cita</b>. Se puede hasta <b>24 horas antes</b>.")
s.append(pantalla("cancelar", [
    ("1", "Sí, cancelar", "La cita queda cancelada, el hueco se libera para otra persona y Silvia recibe un aviso."),
    (None, "No, mantenerla", "Si te lo has pensado mejor, la cita sigue igual."),
]))
s.append(Spacer(1, 8))
s.append(pantalla("tarde", [
    (None, "¿Faltan menos de 24 horas?", "Ya no se puede cancelar desde la web. Sale este aviso para que avises a Silvia directamente:"),
    ("1", "Email", None),
    ("2", "Llamar por teléfono", None),
    ("3", "WhatsApp", "En el móvil abre la app directamente."),
], img_w=64 * mm))

# 8 Historial
s += [PageBreak()] + titulo(8, "Historial y pagos", "Más abajo está el <b>Historial</b>: tus citas pasadas y las canceladas.")
s.append(pantalla("historial", [
    ("1", "Pagada", "Con el importe que pagaste."),
    ("2", "Bono", "Sesiones que se descontaron de tu bono."),
    (None, "¿Hay muchas?", "Si la lista es larga, pulsa «Ver … más» al final para ver las antiguas."),
], img_w=70 * mm, notas=[T("Si ves «Pendiente» en una sesión que ya pagaste, díselo a Silvia para que lo revise.")]))

# 9 Calendario
s += [PageBreak()] + titulo(9, "Tus citas en el calendario del móvil",
                            "Al final de «Gestión de citas». Tus citas aparecen solas en tu calendario y se actualizan si cambian.")
s.append(pantalla("calendario1", [
    ("1", "Conectar con mi calendario", "Aparecen los botones de abajo."),
], img_w=80 * mm))
s.append(Spacer(1, 6))
s.append(pantalla("calendario2", [
    ("1", "Añadir a Google Calendar", "Si usas Google o un móvil Android."),
    ("2", "iPhone / Mac", "Abre el calendario de Apple y pulsa «Suscribirse»."),
    ("3", "Copiar enlace", "Para Outlook u otros: pégalo en «Añadir calendario desde URL»."),
], img_w=80 * mm))
s.append(ojo("Ese enlace es privado: quien lo tenga puede ver tus citas. No lo compartas. Si lo has compartido sin querer, "
             "pulsa <b>Generar enlace nuevo</b> (el anterior deja de funcionar y tendrás que volver a añadirlo)."))
s.append(truco("Google Calendar puede tardar unas horas en mostrar los cambios."))

# 10 Claves
s += [PageBreak()] + titulo(10, "Claves de mi proceso", "En <b>Citas → Claves de mi proceso</b>.")
s.append(pantalla("claves", [
    ("1", "Claves de mi proceso", "Lo que merece la pena recordar de tus sesiones: descubrimientos, aprendizajes y frases para llevarte."),
    (None, "¿Quién las escribe?", "Silvia las revisa antes de compartirlas contigo. Salen por fecha, la más reciente arriba."),
    (None, "¿Y si está vacío?", "Es normal. Aparecen cuando Silvia las comparte después de una sesión."),
], img_w=66 * mm, notas=[T("Por privacidad, las claves solo se pueden leer aquí: no se pueden copiar ni imprimir.")]))

# 11 Documentos y facturas
s += [PageBreak()] + titulo(11, "Documentos y facturas", "Pulsa la pestaña <b>Documentos</b>.")
s.append(pantalla("documentos", [
    ("1", "Descargar PDF", "Tu consentimiento firmado, con la fecha en que lo firmaste. Si alguna vez firmas una versión nueva, las antiguas siguen ahí."),
    ("2", "Descargar (factura)", "Cada factura con su número, fecha, concepto e importe. La más nueva arriba."),
], img_w=60 * mm))
s.append(Spacer(1, 6))
s.append(P("Así se ve una factura (se abre en una ventana nueva):", step_t))
s.append(foto("factura", W * 0.5))
s.append(truco("En la factura, pulsa <b>Descargar / imprimir PDF</b> (abajo a la derecha) para guardarla. "
               "Si no se abre, permite las «ventanas emergentes» para esta web en tu navegador."))

# 12 App
s += [PageBreak()] + titulo(12, "Tenerla como una app", "Puedes poner tu área en la pantalla de inicio del móvil, con el icono de Siloz. "
                            "Se abre directamente en tu área, sin buscar la web.")
s.append(P("En iPhone (Safari)", h2))
s.append(pasos([
    ("1", "Entra en silozpsicologia.com/acceso", None),
    ("2", "Pulsa el botón Compartir", "El cuadrado con una flecha hacia arriba, abajo en la pantalla."),
    ("3", "«Añadir a pantalla de inicio»", "Y después «Añadir»."),
], W))
s.append(P("En Android (Chrome)", h2))
s.append(pasos([
    ("1", "Entra en silozpsicologia.com/acceso", None),
    ("2", "Pulsa los tres puntos", "Arriba a la derecha."),
    ("3", "«Instalar aplicación» o «Añadir a pantalla de inicio»", None),
], W))

# 13 Privacidad
s += [PageBreak()] + titulo(13, "Tu privacidad")
s.append(pasos([
    ("✓", "Solo ves lo tuyo", "Nadie más puede ver tus citas, documentos ni facturas."),
    ("✓", "No hay notas clínicas", "En tu área solo están tus datos de contacto, tus citas, tus pagos y tus documentos."),
    ("✓", "Datos en Europa y cifrados", "Más información en «Privacidad del área privada», debajo del botón Entrar."),
    ("✓", "Si cambia la información de protección de datos", "Verás un aviso con <b>Leer</b> y <b>Entendido</b>. Si pone que no hace falta volver a firmar, no tienes que hacer nada más."),
    ("✓", "¿No quieres que se use IA con tus notas?", "Escríbelo a silozpsicologia@gmail.com y Silvia lo anotará."),
], W, color=SAGE))

# 14 Problemas
s += [PageBreak()] + titulo(14, "Si algo falla", "Las dudas más normales y qué hacer.")
s.append(pasos([("?", a, b) for a, b in [
    ("No me ha llegado el email de invitación", "Mira en spam. Si no está, pide a Silvia que te la reenvíe."),
    ("«El enlace no es válido o ha caducado»", "Pide uno nuevo con «¿Has olvidado tu contraseña?»."),
    ("«Email o contraseña incorrectos»", "Revisa lo que has escrito o crea una contraseña nueva (paso 3)."),
    ("«Tu acceso está desactivado»", "Contacta con Silvia."),
    ("No sale ningún hueco para reservar", "Silvia no tiene huecos abiertos ahora. Escríbele para pedir cita."),
    ("No me deja reservar esa semana", "Ya tienes una cita esa semana. Para otra, habla con Silvia."),
    ("No veo «Cancelar cita»", "Esa cita la puso Silvia, o faltan menos de 24 horas. Avísala directamente."),
    ("No se abre la factura", "Permite las ventanas emergentes en tu navegador."),
    ("«No se pudieron cargar tus citas»", "Recarga la página. Si sigue, prueba más tarde."),
]], W, color=SAGE))
s.append(caja([P("<b>Contacto</b>", cell_b), P("silozpsicologia@gmail.com · 620 450 696 (llamada o WhatsApp)", cell)], bg=CREAM, borde=SAGE_DARK))
s.append(caja([P("<b>Importante</b>", cell_b), P(
    "El área privada no es un servicio de urgencias. Si estás pasando por una crisis o piensas en hacerte daño, "
    "llama al <b>024</b> (gratis, 24 horas) o al <b>112</b>.", cell)], bg=CREAM, borde=RED))

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                        topMargin=16 * mm, bottomMargin=20 * mm,
                        title="Tu área privada — Guía para pacientes de Siloz Psicología", author="Siloz Psicología",
                        subject="Cómo usar el área privada del paciente paso a paso")
doc.build(s, onFirstPage=cover, onLaterPages=page)
print("OK ->", OUT)
