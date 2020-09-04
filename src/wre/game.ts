import { interpret } from '..'
import { Evaluation, Natives, RuntimeObject } from '../interpreter'
import { Id } from '../model'
import natives from './wre.natives'

const newList = (evaluation: Evaluation, ...elements: Id[]) => evaluation.addInstance(new RuntimeObject(
  evaluation.currentContext,
  evaluation.environment.getNodeByFQN('wollok.lang.List'),
  elements,
))

const returnVoid = (evaluation: Evaluation) => {
  evaluation.frameStack.top!.operandStack.push(undefined)
}

const get = (self: RuntimeObject, key: string) => (evaluation: Evaluation) => {
  evaluation.frameStack.top!.operandStack.push(self.get(key))
}

const set = (self: RuntimeObject, key: string, value: RuntimeObject) => (evaluation: Evaluation) => {
  self.set(key, value)
  returnVoid(evaluation)
}

const property = (self: RuntimeObject, key: string, value?: RuntimeObject) => (evaluation: Evaluation) => {
  if (value)
    set(self, key, value)(evaluation)
  else
    get(self, key)(evaluation)
}

const redirectTo = (receiver: (evaluation: Evaluation) => string, voidMessage = true) => (message: string, ...params: string[]) =>
  (evaluation: Evaluation) => {
    const { sendMessage } = interpret(evaluation.environment, natives as Natives)
    sendMessage(message, receiver(evaluation), ...params)(evaluation)
    if (voidMessage) returnVoid(evaluation)
  }

const mirror = (evaluation: Evaluation) => evaluation.environment.getNodeByFQN('wollok.gameMirror.gameMirror').id

const io = (evaluation: Evaluation) => evaluation.environment.getNodeByFQN('wollok.io.io').id

const getPosition = (id: Id) => (evaluation: Evaluation) => {
  const position = evaluation.instance(id).get('position')
  if (position) return position
  const { sendMessage } = interpret(evaluation.environment, natives as Natives)
  const currentFrame = evaluation.frameStack.top!
  sendMessage('position', id)(evaluation)
  return currentFrame.operandStack.pop()
}

const samePosition = (evaluation: Evaluation, position: RuntimeObject) => (id: Id) => {
  const visualPosition = getPosition(id)(evaluation)!
  return position.get('x') === visualPosition.get('x')
    && position.get('y') === visualPosition.get('y')
}

const addVisual = (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation) => {
  if (!self.get('visuals')) {
    self.set('visuals', newList(evaluation))
  }
  const visuals: RuntimeObject = self.get('visuals')!
  visuals.assertIsCollection()
  if (visuals.innerValue.includes(visual.id)) throw new TypeError(visual.module.fullyQualifiedName())
  else visuals.innerValue.push(visual.id)
}

const lookupMethod = (self: RuntimeObject, message: string) => (_evaluation: Evaluation) =>
  self.module.lookupMethod(message, 0)

const game: Natives = {
  game: {
    addVisual: (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      if (visual === evaluation.null()) throw new TypeError('visual')
      const message = 'position' // TODO
      if (!lookupMethod(visual, message)(evaluation)) throw new TypeError(message)
      addVisual(self, visual)(evaluation)
      returnVoid(evaluation)
    },

    addVisualIn: (self: RuntimeObject, visual: RuntimeObject, position: RuntimeObject) => (evaluation: Evaluation): void => {
      if (visual === evaluation.null()) throw new TypeError('visual')
      if (position === evaluation.null()) throw new TypeError('position')
      visual.set('position', position)
      addVisual(self, visual)(evaluation)
      returnVoid(evaluation)
    },

    addVisualCharacter: (_self: RuntimeObject, visual: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('addVisualCharacter', visual.id),


    addVisualCharacterIn: (_self: RuntimeObject, visual: RuntimeObject, position: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('addVisualCharacterIn', visual.id, position.id),

    removeVisual: (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      const visuals = self.get('visuals')
      if (visuals) {
        const { sendMessage } = interpret(evaluation.environment, natives as Natives)
        sendMessage('remove', visuals.id, visual.id)(evaluation)
      }
      returnVoid(evaluation)
    },

    whenKeyPressedDo: (_self: RuntimeObject, event: RuntimeObject, action: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(io)('addEventHandler', event.id, action.id),

    whenCollideDo: (_self: RuntimeObject, visual: RuntimeObject, action: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('whenCollideDo', visual.id, action.id),

    onCollideDo: (_self: RuntimeObject, visual: RuntimeObject, action: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('onCollideDo', visual.id, action.id),

    onTick: (_self: RuntimeObject, milliseconds: RuntimeObject, name: RuntimeObject, action: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('onTick', milliseconds.id, name.id, action.id),

    schedule: (_self: RuntimeObject, milliseconds: RuntimeObject, action: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(mirror)('schedule', milliseconds.id, action.id),

    removeTickEvent: (_self: RuntimeObject, event: RuntimeObject): (evaluation: Evaluation) => void =>
      redirectTo(io)('removeTimeHandler', event.id),

    allVisuals: (self: RuntimeObject) => (evaluation: Evaluation): void => {
      const visuals = self.get('visuals')
      if (!visuals) return evaluation.frameStack.top!.operandStack.push(newList(evaluation))
      const currentVisuals: RuntimeObject = visuals
      currentVisuals.assertIsCollection()
      const result = newList(evaluation, ...currentVisuals.innerValue)
      evaluation.frameStack.top!.operandStack.push(result)
    },

    hasVisual: (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      const visuals = self.get('visuals')
      if (!visuals) return evaluation.frameStack.top!.operandStack.push(evaluation.boolean(false))
      const currentVisuals: RuntimeObject = visuals
      currentVisuals.assertIsCollection()
      evaluation.frameStack.top!.operandStack.push(evaluation.boolean(currentVisuals.innerValue.includes(visual.id)))
    },

    getObjectsIn: (self: RuntimeObject, position: RuntimeObject) => (evaluation: Evaluation): void => {
      const visuals = self.get('visuals')
      if (!visuals) return evaluation.frameStack.top!.operandStack.push(newList(evaluation))
      const currentVisuals: RuntimeObject = visuals
      currentVisuals.assertIsCollection()
      const result = newList(evaluation, ...currentVisuals.innerValue.filter(samePosition(evaluation, position)))
      evaluation.frameStack.top!.operandStack.push(result)
    },

    say: (_self: RuntimeObject, visual: RuntimeObject, message: RuntimeObject) => (evaluation: Evaluation): void => {
      const currentFrame = evaluation.frameStack.top!
      const { sendMessage } = interpret(evaluation.environment, natives as Natives)
      sendMessage('currentTime', io(evaluation))(evaluation)
      const currentTime: RuntimeObject = currentFrame.operandStack.pop()!
      currentTime.assertIsNumber()
      const messageTime = evaluation.number(currentTime.innerValue + 2 * 1000)
      set(visual, 'message', message)(evaluation)
      set(visual, 'messageTime', messageTime)(evaluation)
    },

    clear: (self: RuntimeObject) => (evaluation: Evaluation): void => {
      const { sendMessage } = interpret(evaluation.environment, natives as Natives)
      sendMessage('clear', io(evaluation))(evaluation)
      self.set('visuals', newList(evaluation))
      returnVoid(evaluation)
    },

    colliders: (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      if (visual === evaluation.null()) throw new TypeError('visual')
      const visuals = self.get('visuals')
      if (!visuals) return evaluation.frameStack.top!.operandStack.push(newList(evaluation))
      const currentVisuals: RuntimeObject = visuals
      currentVisuals.assertIsCollection()
      const position = getPosition(visual.id)(evaluation)!
      const result = newList(evaluation, ...currentVisuals.innerValue
        .filter(samePosition(evaluation, position))
        .filter(id => id !== visual.id)
      )
      evaluation.frameStack.top!.operandStack.push(result)
    },

    title: (self: RuntimeObject, title?: RuntimeObject): (evaluation: Evaluation) => void  => property(self, 'title', title),

    width: (self: RuntimeObject, width?: RuntimeObject): (evaluation: Evaluation) => void => property(self, 'width', width),

    height: (self: RuntimeObject, height?: RuntimeObject): (evaluation: Evaluation) => void => property(self, 'height', height),

    ground: (self: RuntimeObject, ground: RuntimeObject): (evaluation: Evaluation) => void => set(self, 'ground', ground),

    boardGround: (self: RuntimeObject, boardGround: RuntimeObject): (evaluation: Evaluation) => void => set(self, 'boardGround', boardGround),

    stop: (self: RuntimeObject) => (evaluation: Evaluation): void => {
      self.set('running', evaluation.boolean(false))
      returnVoid(evaluation)
    },

    hideAttributes: (_self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      visual.set('showAttributes', evaluation.boolean(false))
      returnVoid(evaluation)
    },

    showAttributes: (_self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      visual.set('showAttributes', evaluation.boolean(true))
      returnVoid(evaluation)
    },

    errorReporter: (self: RuntimeObject, visual: RuntimeObject) => (evaluation: Evaluation): void => {
      self.set('errorReporter', visual)
      returnVoid(evaluation)
    },

    // TODO:
    sound: (_self: RuntimeObject, _audioFile: RuntimeObject) => (_evaluation: Evaluation): void => {
      throw new ReferenceError('To be implemented')
    },

    doStart: (self: RuntimeObject, _isRepl: RuntimeObject) => (evaluation: Evaluation): void => {
      self.set('running', evaluation.boolean(true))
      returnVoid(evaluation)
    },
  },
}

export default game