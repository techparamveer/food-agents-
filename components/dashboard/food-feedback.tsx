"use client";

import { useState } from "react";
import { useDashboard } from "@/components/dashboard/data";
import { FOOD_FEEDBACK_OPTIONS, summariseFoodFeedback } from "@/lib/feedback";
import type { FoodFeedbackSentiment } from "@/lib/types";

/** Aggregate anonymous reactions after an order has arrived, with quick entry for new responses. */
export function FoodFeedback({ slotId }: { slotId: string }) {
  const { foodFeedback, update } = useDashboard();
  const [added, setAdded] = useState<FoodFeedbackSentiment | null>(null);
  const summary = summariseFoodFeedback(foodFeedback, slotId);
  const comments = foodFeedback
    .filter((response) => response.slotId === slotId && response.comment)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);

  const addResponse = (sentiment: FoodFeedbackSentiment) => {
    const at = new Date().toISOString();
    update((data) => ({
      ...data,
      foodFeedback: [
        ...data.foodFeedback,
        {
          id: `feedback-${slotId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          slotId,
          sentiment,
          at,
        },
      ],
    }));
    setAdded(sentiment);
  };

  return (
    <section className="food-feedback" aria-labelledby={`food-feedback-${slotId}`}>
      <div className="food-feedback__head">
        <div>
          <p className="food-feedback__eyebrow">Student feedback</p>
          <h4 id={`food-feedback-${slotId}`}>
            {summary.total ? `${summary.lovedPercent}% loved it` : "Waiting for the first response"}
          </h4>
        </div>
        <span className="pill pill--muted">
          {summary.total} {summary.total === 1 ? "response" : "responses"}
        </span>
      </div>

      {summary.total > 0 && (
        <div className="food-feedback__meter" aria-hidden="true">
          {FOOD_FEEDBACK_OPTIONS.map((option) => (
            <span
              key={option.id}
              className={`food-feedback__meter-part food-feedback__meter-part--${option.id}`}
              style={{ width: `${(summary[option.id] / summary.total) * 100}%` }}
            />
          ))}
        </div>
      )}

      <div className="food-feedback__reactions" role="group" aria-label="Record an anonymous student response">
        {FOOD_FEEDBACK_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={added === option.id ? "food-feedback__reaction is-added" : "food-feedback__reaction"}
            onClick={() => addResponse(option.id)}
            aria-label={`Record “${option.label}” feedback`}
          >
            <span className="food-feedback__emoji" aria-hidden="true">{option.emoji}</span>
            <span>
              <strong>{option.label}</strong>
              <small>{summary[option.id]}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="food-feedback__hint" aria-live="polite">
        {added ? `${FOOD_FEEDBACK_OPTIONS.find((option) => option.id === added)?.label} response added anonymously.` : "Tap a reaction to add an anonymous student response."}
      </p>

      {comments.length > 0 && (
        <ul className="food-feedback__comments" aria-label="Recent student comments">
          {comments.map((comment) => {
            const option = FOOD_FEEDBACK_OPTIONS.find((item) => item.id === comment.sentiment)!;
            return (
              <li key={comment.id}>
                <span aria-hidden="true">{option.emoji}</span>
                <q>{comment.comment}</q>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
