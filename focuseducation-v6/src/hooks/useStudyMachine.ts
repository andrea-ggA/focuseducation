import { useReducer } from "react";

export type StudyView =
  | "home"
  | "topic_select_quiz"
  | "topic_select_flashcards"
  | "quiz"
  | "flashcards"
  | "mindmap"
  | "summary";

export interface StudyState {
  view:               StudyView;
  activeQuizId:       string | null;
  activeQuizGamified: boolean;
  activeDeckId:       string | null;
  selectedTopics:     string[] | null;
  customTimerSeconds?: number;
  xpBet?:             number;
  mindMapData:        { nodes: any[]; edges: any[] } | null;
  summaryData:        { content: string; format: string; title: string } | null;
}

export type StudyAction =
  | { type: "UPLOAD_QUIZ";       quizId: string; gamified: boolean }
  | { type: "UPLOAD_FLASHCARDS"; deckId: string }
  | { type: "UPLOAD_MINDMAP";    nodes: any[];   edges: any[] }
  | { type: "UPLOAD_SUMMARY";    content: string; format: string; title: string }
  | { type: "START_QUIZ";        topics: string[] | null; timer?: number; bet?: number }
  | { type: "START_FLASHCARDS";  topics: string[] | null }
  | { type: "BACK" }
  | { type: "BACK_TO_TOPICS" };

const initial: StudyState = {
  view:               "home",
  activeQuizId:       null,
  activeQuizGamified: false,
  activeDeckId:       null,
  selectedTopics:     null,
  mindMapData:        null,
  summaryData:        null,
};

function reducer(state: StudyState, action: StudyAction): StudyState {
  switch (action.type) {
    case "UPLOAD_QUIZ":
      return { ...state, view: "topic_select_quiz", activeQuizId: action.quizId, activeQuizGamified: action.gamified };
    case "UPLOAD_FLASHCARDS":
      return { ...state, view: "topic_select_flashcards", activeDeckId: action.deckId };
    case "UPLOAD_MINDMAP":
      return { ...state, view: "mindmap", mindMapData: { nodes: action.nodes, edges: action.edges } };
    case "UPLOAD_SUMMARY":
      return { ...state, view: "summary", summaryData: { content: action.content, format: action.format, title: action.title } };
    case "START_QUIZ":
      return { ...state, view: "quiz", selectedTopics: action.topics, customTimerSeconds: action.timer, xpBet: action.bet };
    case "START_FLASHCARDS":
      return { ...state, view: "flashcards", selectedTopics: action.topics };
    case "BACK":
      return initial;
    case "BACK_TO_TOPICS":
      return {
        ...state,
        view: state.activeQuizId
          ? "topic_select_quiz"
          : state.activeDeckId
          ? "topic_select_flashcards"
          : "home",
      };
    default:
      return state;
  }
}

export function useStudyMachine() {
  return useReducer(reducer, initial);
}
