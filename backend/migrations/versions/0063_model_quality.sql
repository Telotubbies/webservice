-- 0063 - model quality (F12): the true material a reviewer saw on a material
-- event (confusion matrix source), and a per-model accuracy gate for activation.
ALTER TABLE vision_event_reviews
  ADD COLUMN true_material text CHECK (true_material IS NULL OR true_material IN ('gravel', 'sand', 'no-material'));
ALTER TABLE vision_models
  ADD COLUMN gate_min_accuracy real CHECK (gate_min_accuracy IS NULL OR gate_min_accuracy BETWEEN 0 AND 1),
  ADD COLUMN gate_min_samples integer CHECK (gate_min_samples IS NULL OR gate_min_samples BETWEEN 1 AND 100000);
