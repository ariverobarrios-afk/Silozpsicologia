// Tareas de la sesión (docs/tareas-sesion.md): aviso por email a la psicóloga
// cuando el paciente responde. A propósito NO lleva el texto de la respuesta
// ni el de la tarea: son datos de salud y se leen dentro del área privada.
import { capitalize, madridDate, madridLongDay } from "../shared/madrid";
import { emailSencillo } from "./email";

export interface TaskAnswerInfo {
  task_id: string;
  appointment_id: string;
  starts_at: string;
  answered_at: string;
  changed: boolean;
  patient_name: string;
  patient_email: string;
  psychologist_email: string;
}

export function emailRespuestaTarea(info: TaskAnswerInfo, baseUrl: string) {
  const nombre = info.patient_name || info.patient_email || "Un paciente";
  const { html, texto } = emailSencillo({
    titulo: "Un paciente ha respondido a una tarea",
    filas: [
      ["Paciente", nombre],
      ["Sesión", capitalize(madridLongDay(info.starts_at, true))],
    ],
    parrafos: ["Puedes leer su respuesta, y los archivos que haya adjuntado, en el apartado «Tareas» de la sesión."],
    enlace: { texto: "Ver la respuesta", url: `${baseUrl}/panel/sesion/${info.appointment_id}#tareas` },
  });
  return {
    para: info.psychologist_email,
    asunto: `Tarea respondida: ${nombre} — sesión del ${madridDate(info.starts_at)}`,
    html,
    texto,
  };
}
