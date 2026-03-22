export interface EntityMatchHit {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface EntityMatchResultSections {
  characters: EntityMatchHit[];
  scenes: EntityMatchHit[];
  props: EntityMatchHit[];
}

export interface StoredEpisodeEntityMatch {
  episodeId: string;
  episodeLabel: string;
  matchedAt: string;
  result: EntityMatchResultSections;
}

export function getEpisodeEntityMatchKey(episodeId: string) {
  return `feicai-ai-entity-match-${episodeId}`;
}

export function getEpisodeEntityMatchNames(result: EntityMatchResultSections) {
  return {
    characters: result.characters.map((item) => item.name),
    scenes: result.scenes.map((item) => item.name),
    props: result.props.map((item) => item.name),
  };
}

export function getEpisodeEntityMatchTotal(result: EntityMatchResultSections) {
  return result.characters.length + result.scenes.length + result.props.length;
}
