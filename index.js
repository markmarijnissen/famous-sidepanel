define(function(require, exports, module) {
  var View          = require('famous/core/View');
  var Engine        = require('famous/core/Engine');
  var Modifier        = require('famous/core/Modifier');
  var Transform       = require('famous/core/Transform');
  var StateModifier   = require('famous/modifiers/StateModifier');
  var Easing          = require('famous/transitions/Easing');
  var Transitionable  = require('famous/transitions/Transitionable');
  var GenericSync     = require('famous/inputs/GenericSync');

  /**
   A typical sidepanel that swipes from the left.

   emits events:
      'sidepanel': true (opened) | false (closed)
      'opening'
      'closing'
    

   public API (and listens to)
      open(<boolean> value): true (open) | false (close) | null (toggle)

   **/
  function SidepanelLayout(options) {
      // Inherit from View 
      View.apply(this, arguments);
      // Broadcast created event for mediators
      Engine.emit('created',this);

      // State variables: Show sidepanel or not...
      this.animating = false;
      this.opened = false;

      // Transitionable from [0...1] indicating x-position of content.
      this.position = new Transitionable(0);

      // Add sidepanel 
      if(!!options.sidepanel) {
        _addSidepanel.call(this,options.sidepanel);
      } else {
        Engine.emit('error',{target:this,message:'No sidepanel!'});
      }
      // Add content
      if(!!options.content) {
        _addContent.call(this,options.content);
      } else {
        Engine.emit('error',{target:this,message:'No content!'});
      }

      // Setup swipe handler
      _handleSwipe.call(this);

      // Setup event handler (respond to the 'open' event)
      this._eventInput.on('open',this.open);

  }
  SidepanelLayout.prototype = Object.create(View.prototype);
  SidepanelLayout.prototype.constructor = SidepanelLayout;
  SidepanelLayout.prototype.name = 'SidepanelLayout';

  SidepanelLayout.DEFAULT_OPTIONS = {
    sidepanel: null,    //RenderNode for sidepanel
    content: null,      //RenderNode for content

    maxPos: 1e4,        // Max position (dragging) (x-coordinate)
    width: 225,         // Open position (x-coordinate)
    transition: {
        duration: 300,
        curve: 'easeOut'
    },
    moveThreshold: 20,  // When should you start moving?
    posThreshold: 138,  // When should sidepanel open?
    velThreshold: 0.75, // When should sidepanel open?
  };

  /**
   * Open the sidepanel
   * 
   * @param  {boolean} value    true: open; false: close; null: toggle.
   * @param  {boolean} instant  if true, opens or closes without animation
   */
  SidepanelLayout.prototype.open = function(value,instant) {
    if(value !== false && value !== true) value = !this.opened;
    if(value !== this.opened) {
      if(value) {
        _open.call(this,instant);
      } else {
        _close.call(this,instant);
      }
    }
  };

  /**
   * Helper method when finished opening - update state emit 'sidepanel' event
   */
  function _opened(){
    this.opened = true;
    this.animating = false;
    this._eventOutput.emit('sidepanel',true);
  }

  /**
   * Helper method - actually open the content
   */
  function _open(instant) {
    this._eventOutput.emit('opening');        // emit event
    this.dragging = false;                    // update state
    if(instant === true && !this.animating){  // when instant and not already animating
      this.position.set(1);                   // set position
      _opened.call(this);                     // call finished callback
    } else {
      this.animating = true;                  // update state

      // here is where magic happens: 
      // set position using a transition, then call _opened callback on finished
      this.position.set(1, this.options.transition, _opened.bind(this));
    }
  }

  /**
   * Helper method when finished closing - update state emit 'sidepanel' event
   */
  function _closed(){
    this.opened = false;
    this.animating = false;
    this._eventOutput.emit('sidepanel',false);
  }

  /**
   * Helper method - actually close the panel
   */
  function _close(instant) {
    this._eventOutput.emit('closing');        // emit 'closing' event
    this.dragging = false;                    // update state
    if(instant === true && !this.animating){  // if instant and not already in animation
      this.position.set(0);                   // update position
      _closed.call(this);                     // call finished callback
    } else {
      this.animating = true;                  // update state

      // here is where magic happens: 
      // set position using a transition, then call _closed callback on finished
      this.position.set(0, this.options.transition, _closed.bind(this));
    }
  }

  /**
   * Handle swipe gestures
   */
  function _handleSwipe() {
    // Create a sync that listens to touch and mouse on the X-dimension
    var sync = new GenericSync(
        ['mouse', 'touch'],
        {direction : GenericSync.DIRECTION_X}
    );

    // Forward touch events from SidepanelLayout input to the Sync
    this._eventInput.pipe(sync);

    // When starting: Activate dragging if close to the edge
    sync.on('start',function(data){
      this.dragging = data.clientX < this.options.moveThreshold;
    }.bind(this));

    // When updating
    sync.on('update', function(data) {
        // If we're already in an animation, or not dragging, exit
        if(this.animating || !this.dragging) return;

        // Scale current position (this.position is from [0..1], remember)
        var currentPosition = this.position.get() * this.options.width;
        // Update current position with delta from touch/mouse event.
        // Also, constrain position to [0,this.options.maxPos] 
        var position = Math.max(0, currentPosition + data.delta);
        position = Math.min(this.options.maxPos,position);

        // Scale back to [0...1] and update this.position
        this.position.set(position / this.options.width);
    }.bind(this));

    // When end
    sync.on('end', (function(data) {
        // Update dragging
        this.dragging = false;
        // If already animating, we don't need to check to open/close the panel
        if(this.animating) return;

        // Check velocity and position. Get them first.
        var velocity = data.velocity;
        var position = this.position.get();

        // Some magic decisions....
        if(this.position.get() > this.options.posThreshold / this.options.width) {
            if(velocity < -this.options.velThreshold) {
                _close.call(this);
            } else {
                _open.call(this);
            }
        } else {
            if(velocity > this.options.velThreshold) {
                _open.call(this);
            } else {
                _close.call(this);
            }
        }
    }).bind(this));
  }

  /**
   * Add the content node
   */
  function _addContent(content) {
    this.content = content;
    this.contentMod = new Modifier({
      // The x-coordinate of the content is determined by the 'this.position' Transitionable.
      transform: function() {
          return Transform.translate(this.position.get() * this.options.width, 0, 0);
      }.bind(this)
    });
    this.add(this.contentMod).add(content);
  }

  /**
   * Add the Sidepanel node
   */
  function _addSidepanel(sidepanel) {
    this.sidepanel = sidepanel;
    this.sidepanelMod = new StateModifier({
      transform: Transform.translate(0,0,-1000),
      size: [undefined,undefined]
    });
    this.add(this.sidepanelMod).add(sidepanel);
  }

  module.exports = SidepanelLayout;
});