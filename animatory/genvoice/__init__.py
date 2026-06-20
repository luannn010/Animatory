# animatory/genvoice — voice generation domain (scaffold).
#
# Contracts only: no TTS backend is wired yet. Generates speech from text plus a
# per-character voice profile. It consumes, but does not own, the voice data
# produced upstream:
#   - animatory.enrichment.voice_profiles.aggregate  (emotion/intensity stats)
#   - the entity registry's `voice` block (register/tone/pace from enrichment)
# A real backend (Coqui/XTTS, Eleven, etc.) implements `service.synthesize`.
