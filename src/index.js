const buildElement = function (str) {
  const tmp = document.createElement('div');
  tmp.innerHTML = str;
  return Array.from(tmp.children)[0];
};

const triggerEvent = function (el, name) {
  const event = document.createEvent('HTMLEvents');
  event.initEvent(name, true, false);
  el.dispatchEvent(event);
};

const sum = function (a, b) {
  return a + b;
};

const isCloseTo = function (value, expected) {
  return value > expected - 0.01 && value < expected + 0.01;
};

const detectGestures = function (el, target) {
  let interaction = null;
  let fingers = 0;
  let lastTouchStart = null;
  let startTouches = null;

  const setInteraction = (newInteraction, event) => {
    if (interaction !== newInteraction) {
      if (interaction && !newInteraction) {
        switch (interaction) {
        case 'zoom':
          target.handleZoomEnd(event);
          break;
        case 'drag':
          target.handleDragEnd(event);
          break;
        }
      }

      switch (newInteraction) {
      case 'zoom':
        target.handleZoomStart(event);
        break;
      case 'drag':
        target.handleDragStart(event);
        break;
      }
    }
    interaction = newInteraction;
  };

  const updateInteraction = function (event) {
    if (fingers === 2) {
      setInteraction('zoom');
    } else if (fingers === 1 && target.canDrag()) {
      setInteraction('drag', event);
    } else {
      setInteraction(null, event);
    }
  };

  const targetTouches = function (touches) {
    return Array.from(touches).map((touch) => ({
      x: touch.pageX,
      y: touch.pageY,
    }));
  };

  const getDistance = function (a, b) {
    let x;
    let y;
    x = a.x - b.x;
    y = a.y - b.y;
    return Math.sqrt((x * x) + (y * y));
  };

  const calculateScale = function (startTouches, endTouches) {
    let startDistance = getDistance(startTouches[0], startTouches[1]);
    let endDistance = getDistance(endTouches[0], endTouches[1]);
    return endDistance / startDistance;
  };

  const cancelEvent = function (event) {
    event.stopPropagation();
    event.preventDefault();
  };

  const detectDoubleTap = function (event) {
    let time = (new Date()).getTime();

    if (fingers > 1) {
      lastTouchStart = null;
    }

    if (time - lastTouchStart < 300) {
      cancelEvent(event);

      target.handleDoubleTap(event);
      switch (interaction) {
      case 'zoom':
        target.handleZoomEnd(event);
        break;
      case 'drag':
        target.handleDragEnd(event);
        break;
      }
    }

    if (fingers === 1) {
      lastTouchStart = time;
    }
  };
  let firstMove = true;

  el.addEventListener('touchstart', (event) => {
    if (target.enabled) {
      firstMove = true;
      fingers = event.touches.length;
      detectDoubleTap(event);
    }
  });

  el.addEventListener('touchmove', (event) => {
    if (target.enabled) {
      if (firstMove) {
        updateInteraction(event);
        if (interaction) {
          cancelEvent(event);
        }
        startTouches = targetTouches(event.touches);
      } else {
        switch (interaction) {
        case 'zoom':
          target.handleZoom(event, calculateScale(startTouches, targetTouches(event.touches)));
          break;
        case 'drag':
          target.handleDrag(event);
          break;
        }
        if (interaction) {
          cancelEvent(event);
          target.update();
        }
      }

      firstMove = false;
    }
  });

  el.addEventListener('touchend', (event) => {
    if (target.enabled) {
      fingers = event.touches.length;
      updateInteraction(event);
    }
  });
};

class ImageZoom {
  constructor(el, options) {
    this.defaults = {
      tapZoomFactor: 2,
      zoomOutFactor: 1.3,
      animationDuration: 300,
      maxZoom: 4,
      minZoom: 0.5,
      lockDragAxis: false,
      use2d: true,
      zoomStartEventName: 'pz_zoomstart',
      zoomEndEventName: 'pz_zoomend',
      dragStartEventName: 'pz_dragstart',
      dragEndEventName: 'pz_dragend',
      doubleTapEventName: 'pz_doubletap',
    };
    this.el = el;
    this.zoomFactor = 1;
    this.lastScale = 1;
    this.offset = {
      x: 0,
      y: 0,
    };
    this.options = Object.assign({}, this.defaults, options);
    this.setupMarkup();
    this.bindEvents();
    this.update();
    this.enable();
  }

  handleDragStart(event) {
    triggerEvent(this.el, this.options.dragStartEventName);
    this.stopAnimation();
    this.lastDragPosition = false;
    this.hasInteraction = true;
    this.handleDrag(event);
  }

  handleDrag(event) {
    if (this.zoomFactor > 1.0) {
      const touch = this.getTouches(event)[0];
      this.drag(touch, this.lastDragPosition);
      this.offset = this.sanitizeOffset(this.offset);
      this.lastDragPosition = touch;
    }
  }

  handleDragEnd() {
    triggerEvent(this.el, this.options.dragEndEventName);
    this.end();
  }

  handleZoomStart(event) {
    triggerEvent(this.el, this.options.zoomStartEventName);
    this.stopAnimation();
    this.lastScale = 1;
    this.nthZoom = 0;
    this.lastZoomCenter = false;
    this.hasInteraction = true;
  }
  handleZoom(event, newScale) {
    // a relative scale factor is used
    let touchCenter = this.getTouchCenter(this.getTouches(event));
    let scale = newScale / this.lastScale;
    this.lastScale = newScale;

    // the first touch events are thrown away since they are not precise
    this.nthZoom += 1;
    if (this.nthZoom > 3) {
      this.scale(scale, touchCenter);
      this.drag(touchCenter, this.lastZoomCenter);
    }
    this.lastZoomCenter = touchCenter;
  }

  handleZoomEnd() {
    triggerEvent(this.el, this.options.zoomEndEventName);
    this.end();
  }

  handleDoubleTap(event) {
    let center = this.getTouches(event)[0];
    let zoomFactor = this.zoomFactor > 1 ? 1 : this.options.tapZoomFactor;
    let startZoomFactor = this.zoomFactor;
    let updateProgress = (function (progress) {
      this.scaleTo(startZoomFactor + progress * (zoomFactor - startZoomFactor), center);
    }).bind(this);

    if (this.hasInteraction) {
      return;
    }
    if (startZoomFactor > zoomFactor) {
      center = this.getCurrentZoomCenter();
    }

    this.animate(this.options.animationDuration, updateProgress, this.swing);
    triggerEvent(this.el, this.options.doubleTapEventName);
  }
  sanitizeOffset(offset) {
    let maxX = (this.zoomFactor - 1) * this.getContainerX();
    let maxY = (this.zoomFactor - 1) * this.getContainerY();
    let maxOffsetX = Math.max(maxX, 0);
    let maxOffsetY = Math.max(maxY, 0);
    let minOffsetX = Math.min(maxX, 0);
    let minOffsetY = Math.min(maxY, 0);

    return {
      x: Math.min(Math.max(offset.x, minOffsetX), maxOffsetX),
      y: Math.min(Math.max(offset.y, minOffsetY), maxOffsetY),
    };
  }
  scaleTo(zoomFactor, center) {
    this.scale(zoomFactor / this.zoomFactor, center);
  }
  scale(scale, center) {
    const _scale = this.scaleZoomFactor(scale);
    this.addOffset({
      x: (_scale - 1) * (center.x + this.offset.x),
      y: (_scale - 1) * (center.y + this.offset.y),
    });
  }
  scaleZoomFactor(scale) {
    const originalZoomFactor = this.zoomFactor;
    this.zoomFactor *= scale;
    this.zoomFactor = Math.min(this.options.maxZoom, Math.max(this.zoomFactor, this.options.minZoom));
    return this.zoomFactor / originalZoomFactor;
  }
  drag(center, lastCenter) {
    if (lastCenter) {
      if (this.options.lockDragAxis) {
        if (Math.abs(center.x - lastCenter.x) > Math.abs(center.y - lastCenter.y)) {
          this.addOffset({
            x: -(center.x - lastCenter.x),
            y: 0,
          });
        } else {
          this.addOffset({
            y: -(center.y - lastCenter.y),
            x: 0,
          });
        }
      } else {
        this.addOffset({
          y: -(center.y - lastCenter.y),
          x: -(center.x - lastCenter.x),
        });
      }
    }
  }

  getTouchCenter(touches) {
    return this.getVectorAvg(touches);
  }

  getVectorAvg(vectors) {
    return {
      x: vectors.map((v) => v.x).reduce(sum) / vectors.length,
      y: vectors.map((v) => v.y).reduce(sum) / vectors.length,
    };
  }

  addOffset(offset) {
    this.offset = {
      x: this.offset.x + offset.x,
      y: this.offset.y + offset.y,
    };
  }

  sanitize() {
    if (this.zoomFactor < this.options.zoomOutFactor) {
      this.zoomOutAnimation();
    } else if (this.isInsaneOffset(this.offset)) {
      this.sanitizeOffsetAnimation();
    }
  }

  isInsaneOffset(offset) {
    let sanitizedOffset = this.sanitizeOffset(offset);
    return sanitizedOffset.x !== offset.x ||
            sanitizedOffset.y !== offset.y;
  }

  sanitizeOffsetAnimation() {
    let targetOffset = this.sanitizeOffset(this.offset);
    let startOffset = {
      x: this.offset.x,
      y: this.offset.y,
    };
    let updateProgress = (function (progress) {
      this.offset.x = startOffset.x + progress * (targetOffset.x - startOffset.x);
      this.offset.y = startOffset.y + progress * (targetOffset.y - startOffset.y);
      this.update();
    }).bind(this);

    this.animate(
      this.options.animationDuration,
      updateProgress,
      this.swing
    );
  }

  zoomOutAnimation() {
    let startZoomFactor = this.zoomFactor;
    let zoomFactor = 1;
    let center = this.getCurrentZoomCenter();
    let updateProgress = (function (progress) {
      this.scaleTo(startZoomFactor + progress * (zoomFactor - startZoomFactor), center);
    }).bind(this);

    this.animate(
      this.options.animationDuration,
      updateProgress,
      this.swing
    );
  }

  updateAspectRatio() {
    this.setContainerY(this.getContainerX() / this.getAspectRatio());
  }

  getInitialZoomFactor() {
    return this.container.offsetWidth / this.el.offsetWidth;
  }

  getAspectRatio() {
    return this.el.offsetWidth / this.el.offsetHeight;
  }

  getCurrentZoomCenter() {
    // uses following formula to calculate the zoom center x value
    // offset_left / offset_right = zoomcenter_x / (container_x - zoomcenter_x)
    let length = this.container.offsetWidth * this.zoomFactor;
    let offsetLeft = this.offset.x;
    let offsetRight = length - offsetLeft - this.container.offsetWidth;
    let widthOffsetRatio = offsetLeft / offsetRight;
    let centerX = widthOffsetRatio * this.container.offsetWidth / (widthOffsetRatio + 1);

    // the same for the zoomcenter y
    let height = this.container.offsetHeight * this.zoomFactor;
    let offsetTop = this.offset.y;
    let offsetBottom = height - offsetTop - this.container.offsetHeight;
    let heightOffsetRatio = offsetTop / offsetBottom;
    let centerY = heightOffsetRatio * this.container.offsetHeight / (heightOffsetRatio + 1);

    if (offsetRight === 0) {
      centerX = this.container.offsetWidth;
    }
    if (offsetBottom === 0) {
      centerY = this.container.offsetHeight;
    }

    return {
      x: centerX,
      y: centerY,
    };
  }

  canDrag() {
    return !isCloseTo(this.zoomFactor, 1);
  }

  getTouches(event) {
    let rect = this.container.getBoundingClientRect();
    let posTop = rect.top + document.body.scrollTop;
    let posLeft = rect.left + document.body.scrollLeft;

    return Array.prototype.slice.call(event.touches).map((touch) => ({
      x: touch.pageX - posLeft,
      y: touch.pageY - posTop,
    }));
  }

  animate(duration, framefn, timefn, callback) {
    let startTime = new Date().getTime();
    let renderFrame = (function () {
      if (!this.inAnimation) {
        return;
      }
      let frameTime = new Date().getTime() - startTime;
      let progress = frameTime / duration;
      if (frameTime >= duration) {
        framefn(1);
        if (callback) {
          callback();
        }
        this.update();
        this.stopAnimation();
        this.update();
      } else {
        if (timefn) {
          progress = timefn(progress);
        }
        framefn(progress);
        this.update();
        requestAnimationFrame(renderFrame);
      }
    }).bind(this);
    this.inAnimation = true;
    requestAnimationFrame(renderFrame);
  }

  stopAnimation() {
    this.inAnimation = false;
  }

  swing(p) {
    return -Math.cos(p * Math.PI) / 2 + 0.5;
  }

  getContainerX() {
    return this.container.offsetWidth;
  }

  getContainerY() {
    return this.container.offsetHeight;
  }

  setContainerY(y) {
    return this.container.style.height = `${y}px`;
  }

  setupMarkup() {
    this.container = buildElement('<div class="pinch-zoom-container"></div>');
    this.el.parentNode.insertBefore(this.container, this.el);
    this.container.appendChild(this.el);

    this.container.style.overflow = 'hidden';
    this.container.style.position = 'relative';

    this.el.style.webkitTransformOrigin = '0% 0%';
    this.el.style.mozTransformOrigin = '0% 0%';
    this.el.style.msTransformOrigin = '0% 0%';
    this.el.style.oTransformOrigin = '0% 0%';
    this.el.style.transformOrigin = '0% 0%';

    this.el.style.position = 'absolute';
  }

  end() {
    this.hasInteraction = false;
    this.sanitize();
    this.update();
  }

  bindEvents() {
    const self = this;
    detectGestures(this.container, this);

    window.addEventListener('resize', this.update.bind(this));
    Array.from(this.el.querySelectorAll('img')).forEach((imgEl) => {
      imgEl.addEventListener('load', self.update.bind(self));
    });

    if (this.el.nodeName === 'IMG') {
      this.el.addEventListener('load', this.update.bind(this));
    }
  }

  update() {
    if (this.updatePlaned) {
      return;
    }
    this.updatePlaned = true;

    setTimeout(() => {
      this.updatePlaned = false;
      this.updateAspectRatio();

      let zoomFactor = this.getInitialZoomFactor() * this.zoomFactor;
      let offsetX = -this.offset.x / zoomFactor;
      let offsetY = -this.offset.y / zoomFactor;
      let transform3d = `scale3d(${zoomFactor}, ${zoomFactor},1) translate3d(${offsetX}px,${offsetY}px,0px)`;
      let transform2d = `scale(${zoomFactor}, ${zoomFactor}) translate(${offsetX}px,${offsetY}px)`;
      let removeClone = (function () {
        if (this.clone) {
          this.clone.parentNode.removeChild(this.clone);
          delete this.clone;
        }
      }).bind(this);

      // Scale 3d and translate3d are faster (at least on ios)
      // but they also reduce the quality.
      if (!this.options.use2d || this.hasInteraction || this.inAnimation) {
        this.is3d = true;
        removeClone();
        this.el.style.webkitTransform = transform3d;
        this.el.style.mozTransform = transform2d;
        this.el.style.msTransform = transform2d;
        this.el.style.oTransform = transform2d;
        this.el.style.transform = transform3d;
      } else {
        // When changing from 3d to 2d transform webkit has some glitches.
        // To avoid this, a copy of the 3d transformed element is displayed in the
        // foreground while the element is converted from 3d to 2d transform
        if (this.is3d) {
          this.clone = this.el.cloneNode(true);
          this.clone.style.pointerEvents = 'none';
          this.container.appendChild(this.clone);
          setTimeout(removeClone, 200);
        }

        this.el.style.webkitTransform = transform2d;
        this.el.style.mozTransform = transform2d;
        this.el.style.msTransform = transform2d;
        this.el.style.oTransform = transform2d;
        this.el.style.transform = transform2d;

        this.is3d = false;
      }
    }, 0);
  }
  enable() {
    this.enabled = true;
  }
  disable() {
    this.enabled = false;
  }
}

export default ImageZoom;
