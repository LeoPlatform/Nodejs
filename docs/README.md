1. typedoc

    ``npm install --save-dev typedoc``
    
    Used to generate the SDK documentations.

1. typedoc replace plugin

    ``npm install typedoc-plugin-replace-in-comments --save-dev``

    Used to replace these variables in the TypeDoc comments

    * **rstreams-site-url** => https://rstreams.org
    
1. custom tags in typedoc

   npm install --save-dev typedoc-plugin-custom-tags

   --custom-tags-config docs/typedoc-tags-config.json
   

   Was added since typedoc doesn't yet support the tsDoc @privateRemarks.  Used this
   to hide these tags so they don't show up in the docs.

1. tsdoc syntax used
    tsdoc syntax guide: https://tsdoc.org/
    typedoc syntax guide: https://typedoc.org/guides/doccomments/

    * @deprecated - must be first thing in the doc comment, then text can follow
    
    * @internal - must be first thing in the doc comment, then text can follow,
      for internal use only, will be removed from generated docs

    * typedoc automatically copies the doc comments for functions that reference
      other functions as in `load: typeof StreamUtil.load;`.  The StreaUtil.load
      comment will be used.  Even if you try to put a doc comment on this
      attribute, it will be ignored.
    * Link style we are using : [[`RStreamsSdk.enrich`]]  .  The ` characters 
      make it look like code which helps in reading the docs.  Use a . character
      to link to members inside the class/interface/module.
    * function params must be documented with @param followed by the name 
      followed by your comment as in the following (note don't need type).
      `@param obj the object to act on`

      Note the tsdoc spec asks for a hyphen after the param name.  Seems OK to omit it
      unless the param name is weird.
    * Type params, generics, should be documented with @typeParam followed by the name of the
      type variable followed by the comment as in
      `@typeParam T the payload to act on`

      Note the tsdoc spec asks for a hyphen after the type name.  Seems OK to omit it
      unless the type name is weird.
    * Reference other related things like this
      @see [[`ConfigProviderChain`]]

    * @todo inconsistent <name> 
      Use this when you find inconsistent naming in the docs so we can clean them up
      This won't be included in the resulting documentation.  The example below tells us the function has an inconsistently named param variable named bot_id.

      `@todo inconsistent bot_id` 

    * @todo review
      Not sure if the docs written are correct.  They need to be verified.  

    * @todo question <question>
      This means the question needs answering to complete the doc.  Read the doc and see where the question
      answer needs to be placed and put it there.

      