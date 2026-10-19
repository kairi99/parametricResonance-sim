// Panel UI strings for the guided-learning panel; the language state is shared (../i18n.js).
import { addStrings } from '../i18n.js?v=8644c0b';
export { getLang, setLang, onLangChange, t, pick } from '../i18n.js?v=8644c0b';

export const STRINGS = {
  es: {
    learn: 'Aprender', tasks: 'Tareas guiadas', back: 'Volver',
    levels: ['', 'Introducción', 'Básica', 'Reto'],
    steps: ['Predice', 'Actúa', 'Observa', 'Explica'],
    yourValue: 'Tu valor', commit: 'Fijar mi predicción', startTask: 'Preparar el simulador',
    waiting: 'La tarea se completa sola cuando lo logres.',
    done: '¡Hecho!', yourPrediction: 'Tu predicción',
    measuredValue: 'Medido', expected: 'Esperado', yourExplanation: 'Tu explicación',
    explanationPlaceholder: 'Explica con tus palabras qué ocurrió y por qué…',
    teacher: 'Nota para docentes', resetTask: 'Reiniciar tarea', resetAll: 'Reiniciar todo',
    report: 'Descargar informe', studentName: 'Nombre del estudiante',
    progress: '{n} de {m} completadas', close: 'Cerrar',
    modelHint: 'Esta tarea usa el modelo {m}', lookHere: 'Mostrar el control',
    wrongModel: 'El modelo actual no es el que usa esta tarea; pulsa «Preparar el simulador».',
    showHint: 'Ver una pista', hintNote: 'Si la usas, el informe lo registra.', hint: 'Pista',
    showExplanation: 'Escribir mi explicación', submit: 'Enviar mi explicación',
    submitNeed: 'Escribe al menos {n} caracteres para enviar.',
    lockedNote: 'Al enviar tu explicación verás la explicación del modelo y la nota para docentes. Después ya no podrás editarla.',
    modelExplanation: 'Explicación',
  },
  en: {
    learn: 'Learn', tasks: 'Guided tasks', back: 'Back',
    levels: ['', 'Intro', 'Core', 'Challenge'],
    steps: ['Predict', 'Act', 'Observe', 'Explain'],
    yourValue: 'Your value', commit: 'Lock in my prediction', startTask: 'Set up the simulator',
    waiting: 'The task completes by itself once you get there.',
    done: 'Done!', yourPrediction: 'Your prediction',
    measuredValue: 'Measured', expected: 'Expected', yourExplanation: 'Your explanation',
    explanationPlaceholder: 'Explain in your own words what happened and why…',
    teacher: 'Note for teachers', resetTask: 'Reset task', resetAll: 'Reset all',
    report: 'Download report', studentName: 'Student name',
    progress: '{n} of {m} done', close: 'Close',
    modelHint: 'This task uses the {m} model', lookHere: 'Show me the control',
    wrongModel: 'The current model is not the one this task uses; press "Set up the simulator".',
    showHint: 'Show a hint', hintNote: 'If you use it, the report records it.', hint: 'Hint',
    showExplanation: 'Write my explanation', submit: 'Submit my explanation',
    submitNeed: 'Write at least {n} characters to submit.',
    lockedNote: 'After you submit, you will see the model explanation and the teacher note. Your explanation can no longer be edited.',
    modelExplanation: 'Explanation',
  },
};

addStrings(STRINGS);
