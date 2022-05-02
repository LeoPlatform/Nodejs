1. typedoc

    ``npm install --save-dev typedoc``
    
    Used to generate the SDK documentations.

1. typedoc replace plugin

    ``npm install typedoc-plugin-replace-text --save-dev``

    Used to replace these variables in the TypeDoc comments

    * **rstreams-site-url** => https://rstreams.org

1. stop inheriting docs when I don't want it to plugin

   npm install typedoc-plugin-no-inherit --save-dev

   then use `@noInheritDoc` 

<!-- 1. Add rstreams-specific typedoc plugin located in docs/typedoc-plugin-rstreams.  The top-level package.json's
   preinstall will automatically run anytime npm install is run that will also npm install in the 
   docs/typedoc-plugin-rstreams directory as well as compile the typescript.  Then, the npm install will continue
   and references the just built plugin locally.
   
   ``npm add -D ./docs/typedoc-plugin-rstreams`` -->

1. installed VSCode extension Todo Tree to see @todo's in code, a new icon on the far left called TODO's will show up.
   Change the background/foreground highlight if you don't like the yellow color that shows up in the code
   for the tag.  Background color set to none so it won't set the background color.

   Add this to your settings.json
   ```json
    "todo-tree.regex.regex": "(//|#|<!--|/\\*|\\* @|^\\s*\\*)\\s*($TAGS)",
    "todo-tree.regex.regexCaseSensitive": false,
    "todo-tree.general.tags": [
        "BUG",
        "HACK",
        "FIXME",
        "TODO",
        "XXX",
        "[ ]",
        "[x]",
        "TODO question",
        "TODO unclear",
        "TODO example",
        "TODO inconsistent",
        "TODO review",
        "TODO docbug",
        "TODO incomplete",
        "TODO document"
    ],
    ,
    "todo-tree.highlights.defaultHighlight": {
      "background": "none",
      "foreground": "yellow"
    }
   ```

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

    * @todo example
      Needs a code example.

    * @todo unclear
      Means the doc is unclear and needs more detail.    

    * @noInheritDoc
      Plugin installed to prevent inherited docs for example StatsStream inherits from Node's Transform but I don't want 100 inherited functions
      no one cares about to show up and hide the two functions added.

    * @todo docbug <description>  
      when something isn't working in the docs

    * @todo incomplete <description>
      the doc needs more attention

    * @todo document
      marking that it needs documentation at all

    * @method
      Convert a property that is a reference to a function to be an actual method.

    * @function
      

      