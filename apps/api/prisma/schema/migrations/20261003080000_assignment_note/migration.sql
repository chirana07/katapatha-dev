-- The dispatcher's free-text note on a deferral ("Other · add a note"),
-- captured at confirm time and copied to Deferral.note at publication.
ALTER TABLE "Assignment" ADD COLUMN "note" TEXT;
