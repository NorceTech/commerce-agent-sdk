import React from 'react';
import type { RefinementAction } from '../types';

interface RefinementsProps {
  refinements: RefinementAction[];
  onSendMessage: (message: string) => void;
}

export const Refinements: React.FC<RefinementsProps> = ({ refinements, onSendMessage }) => {
  return (
    <div className="agent-widget-refinements">
      {refinements.map((refinement) => (
        <button
          key={refinement.id}
          className="agent-widget-refinement-chip"
          onClick={() => onSendMessage(refinement.label)}
        >
          {refinement.label}
        </button>
      ))}
    </div>
  );
};
