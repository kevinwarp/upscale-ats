const {
  STAGES,
  VALID_TRANSITIONS,
  isValidStage,
  isTerminalStage,
  getValidTransitions,
} = require('../../src/services/workflowEngine');

describe('workflowEngine', () => {
  describe('STAGES', () => {
    it('defines all 6 TRD stages', () => {
      const keys = Object.keys(STAGES);
      expect(keys).toEqual([
        'in_pipeline',
        'phone_screen',
        'homework_assignment',
        'onsite_interview',
        'offer',
        'rejected',
      ]);
    });

    it('has sequential order values', () => {
      const orders = Object.values(STAGES).map((s) => s.order);
      expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('marks only rejected as terminal', () => {
      const terminal = Object.entries(STAGES).filter(([, v]) => v.terminal);
      expect(terminal).toHaveLength(1);
      expect(terminal[0][0]).toBe('rejected');
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('allows in_pipeline → phone_screen', () => {
      expect(VALID_TRANSITIONS.in_pipeline).toContain('phone_screen');
    });

    it('allows phone_screen → homework_assignment', () => {
      expect(VALID_TRANSITIONS.phone_screen).toContain('homework_assignment');
    });

    it('allows homework_assignment → onsite_interview', () => {
      expect(VALID_TRANSITIONS.homework_assignment).toContain('onsite_interview');
    });

    it('allows onsite_interview → offer', () => {
      expect(VALID_TRANSITIONS.onsite_interview).toContain('offer');
    });

    it('allows any non-terminal stage → rejected', () => {
      for (const [stage, targets] of Object.entries(VALID_TRANSITIONS)) {
        if (stage !== 'rejected') {
          expect(targets).toContain('rejected');
        }
      }
    });

    it('does not allow transitions out of rejected', () => {
      expect(VALID_TRANSITIONS.rejected).toEqual([]);
    });

    it('does not allow skipping stages (e.g. in_pipeline → onsite_interview)', () => {
      expect(VALID_TRANSITIONS.in_pipeline).not.toContain('onsite_interview');
      expect(VALID_TRANSITIONS.in_pipeline).not.toContain('offer');
    });

    it('does not allow backward transitions', () => {
      expect(VALID_TRANSITIONS.phone_screen).not.toContain('in_pipeline');
      expect(VALID_TRANSITIONS.onsite_interview).not.toContain('phone_screen');
    });
  });

  describe('isValidStage', () => {
    it('returns true for valid stages', () => {
      expect(isValidStage('in_pipeline')).toBe(true);
      expect(isValidStage('phone_screen')).toBe(true);
      expect(isValidStage('rejected')).toBe(true);
    });

    it('returns false for invalid stages', () => {
      expect(isValidStage('applied')).toBe(false);
      expect(isValidStage('hired')).toBe(false);
      expect(isValidStage('')).toBe(false);
      expect(isValidStage(null)).toBe(false);
    });
  });

  describe('isTerminalStage', () => {
    it('returns true for rejected', () => {
      expect(isTerminalStage('rejected')).toBe(true);
    });

    it('returns false for non-terminal stages', () => {
      expect(isTerminalStage('in_pipeline')).toBe(false);
      expect(isTerminalStage('offer')).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('returns correct transitions for in_pipeline', () => {
      expect(getValidTransitions('in_pipeline')).toEqual(['phone_screen', 'rejected']);
    });

    it('returns empty array for rejected', () => {
      expect(getValidTransitions('rejected')).toEqual([]);
    });

    it('returns empty array for unknown stages', () => {
      expect(getValidTransitions('nonexistent')).toEqual([]);
    });
  });
});
