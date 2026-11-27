/* Parent side of the See-through actor. It only exists so the browser can send the page a message
   ("the setting changed") with getActor("FolioSeeThrough").sendAsyncMessage(...). It receives nothing. */
export class FolioSeeThroughParent extends JSWindowActorParent {}
