import { fiberizeChildren } from "./createElement";
import { extend, options, typeNumber, emptyObject, isFn, returnFalse, returnTrue } from "../src/util";
import { drainQueue, enqueueUpdater } from "./scheduler";
import { pushError, captureError } from "./ErrorBoundary";
import { Refs } from "./Refs";
function alwaysNull() {
    return null;
}
const support16 = true;
const errorType = {
    0: "undefined",
    2: "boolean",
    3: "number",
    4: "string",
    7: "array"
};
/**
 * 为了防止污染用户的实例，需要将操作组件虚拟DOM与生命周期钩子的逻辑全部抽象到这个类中
 * 
 * @export
 * @param {any} instance 
 * @param {any} vnode 
 */
export function CompositeUpdater(instance, vnode) {
    vnode.stateNode = instance;
    instance.updater = this;
    this.instance = instance;
    this.vnode = vnode;
    this._pendingCallbacks = [];
    this._pendingStates = [];
    this._jobs = ["resolve"];
    this._mountOrder = Refs.mountOrder++;
    var type = vnode.type;
    this.name = type.displayName || type.name;
    // update总是保存最新的数据，如state, props, context, parentContext, parentVnode
    //  this._hydrating = true 表示组件会调用render方法及componentDidMount/Update钩子
    //  this._renderInNextCycle = true 表示组件需要在下一周期重新渲染
    //  this._forceUpdate = true 表示会无视shouldComponentUpdate的结果
    if (instance.__isStateless) {
        this.mergeStates = alwaysNull;
    }
}

CompositeUpdater.prototype = {
    addJob: function(newJob) {
        var jobs = this._jobs;
        if (jobs[jobs.length - 1] !== newJob) {
            jobs.push(newJob);
        }
    },
    exec(updateQueue) {
        var job = this._jobs.shift();
        if (job) {
            this[job](updateQueue);
        }
    },
    enqueueSetState(state, cb) {
        if (isFn(cb)) {
            this._pendingCallbacks.push(cb);
        }
        if (state === true) {
            //forceUpdate
            this._forceUpdate = true;
        } else {
            //setState
            this._pendingStates.push(state);
        }
        if (options.async) {
            //在事件句柄中执行setState会进行合并
            enqueueUpdater(this);
            return;
        }

        if (this.isMounted === returnFalse) {
            //组件挂载期
            //componentWillUpdate中的setState/forceUpdate应该被忽略
            if (this._hydrating) {
                //在render方法中调用setState也会被延迟到下一周期更新.这存在两种情况，
                //1. 组件直接调用自己的setState
                //2. 子组件调用父组件的setState，
                this._renderInNextCycle = returnTrue;
            }
        } else {
            //组件更新期
            if (this._receiving) {
                //componentWillReceiveProps中的setState/forceUpdate应该被忽略
                return;
            }
            if (this._hydrating) {
                //在componentDidMount方法里面可能执行多次setState方法，来引发update，但我们只需要一次update
                this._renderInNextCycle = returnTrue;
                // 在componentDidMount里调用自己的setState，延迟到下一周期更新
                // 在更新过程中， 子组件在componentWillReceiveProps里调用父组件的setState，延迟到下一周期更新
                return;
            }
            this.addJob("hydrate");
            drainQueue([this]);
        }
    },
    mergeStates() {
        let instance = this.instance,
            pendings = this._pendingStates,
            n = pendings.length,
            state = instance.state;
        if (n === 0) {
            return state;
        }
        let nextState = extend({}, state); //每次都返回新的state
        for (let i = 0; i < n; i++) {
            let pending = pendings[i];
            if (pending && pending.call) {
                pending = pending.call(instance, nextState, this.props);
            }
            extend(nextState, pending);
        }
        pendings.length = 0;
        return nextState;
    },

    isMounted: returnFalse,
    hydrate(updateQueue) {
        let { instance, context, props, vnode, pendingVnode } = this;
        if (this._receiving) {
            let [lastVnode, nextVnode, nextContext] = this._receiving;
            nextVnode.stateNode = instance;
            // instance._hasError = false;
            //如果context与props都没有改变，那么就不会触发组件的receive，render，update等一系列钩子
            //但还会继续向下比较
            captureError(instance, "componentWillReceiveProps", [this.props, nextContext]);
            delete this._receiving;
            if(lastVnode.ref !== nextVnode.ref) {
                Refs.detachRef(lastVnode);
            }
        }
        // Refs.clearElementRefs();
        let state = this.mergeStates();
        let shouldUpdate = true;

        if (!this._forceUpdate && !captureError(instance, "shouldComponentUpdate", [props, state, context])) {
            shouldUpdate = false;
            if (pendingVnode) {
                this.vnode = pendingVnode;
                delete this.pendingVnode;
            }
        } else {
            captureError(instance, "componentWillUpdate", [props, state, context]);
            var { props: lastProps, state: lastState } = instance;
            this._hookArgs = [lastProps, lastState];
        }
        vnode.stateNode = instance;
        delete this._forceUpdate;
        //既然setState了，无论shouldComponentUpdate结果如何，用户传给的state对象都会作用到组件上
        instance.props = props;
        instance.state = state;
        instance.context = context;
        this.addJob("resolve");
        if (shouldUpdate) {
            this._hydrating = true;
            this.render(updateQueue);
        }
        updateQueue.push(this);
    },
    render(updateQueue) {
        let { vnode, pendingVnode, instance, parentContext } = this,
            nextChildren = emptyObject,
            lastChildren = emptyObject,
            childContext = parentContext,
            rendered,
            number;

        if (pendingVnode) {
            vnode = this.vnode = pendingVnode;
            delete this.pendingVnode;
        }
        if (this.willReceive === false) {
            rendered = vnode.child;
            delete this.willReceive;
        } else {
            let lastOwn = Refs.currentOwner;
            Refs.currentOwner = instance;
          
            rendered = captureError(instance, "render", []);
            if (instance._hasError) {
                rendered = true;
            }
            Refs.currentOwner = lastOwn;
        }
        number = typeNumber(rendered);
        var hasMounted = this.isMounted();
        if (hasMounted) {
            lastChildren = this.children;
        }
        if (number > 2) {
            if (number > 5) {
                //array, object
                childContext = getChildContext(instance, parentContext);
            }
            nextChildren = fiberizeChildren(rendered, this);
        } else {
            //undefinded, null, boolean
            this.children = nextChildren; //emptyObject
        }
        var noSupport = !support16 && errorType[number];
        if (noSupport) {
            pushError(instance, "render", new Error("React15 fail to render " + noSupport));
        }
        options.diffChildren(lastChildren, nextChildren, vnode, childContext, updateQueue);
    },
    //此方法用于处理元素ref, ComponentDidMount/update钩子，React Chrome DevTools的钩子， 组件ref, 及错误边界
    resolve(updateQueue) {
        let instance = this.instance;
        let hasMounted = this.isMounted();
        let hasCatch = this._hasCatch;
        if (!hasMounted) {
            this.isMounted = returnTrue;
        }
        //如果发生错误，之前收集的元素ref也不会执行，因为结构都不对，没有意义
        // Refs.clearElementRefs();
        if (this._hydrating) {
            let hookName = hasMounted ? "componentDidUpdate" : "componentDidMount";
            captureError(instance, hookName, this._hookArgs || []);
            //执行React Chrome DevTools的钩子
            if (hasMounted) {
                options.afterUpdate(instance);
            } else {
                options.afterMount(instance);
            }
            delete this._hookArgs;
            delete this._hydrating;
        }
        let vnode = this.vnode;

        if (hasCatch) {
            delete this._hasCatch;
            instance._hasTry = true;
            //收集它上方的updater,强行结束它们
            var p = vnode.return;
            do{
                if(p.vtype > 1){
                    var u = p.stateNode.updater;
                    u.addJob("resolve");
                    updateQueue.push(u);
                }
            }while((p = p.return));
            this._hydrating = true;//让它不要立即执行，先执行其他的
            instance.componentDidCatch.apply(instance, hasCatch);
            this._hydrating = false;
        } else {
            //执行组件ref（发生错误时不执行）
            if (vnode._hasRef) {
                Refs.fireRef(vnode, instance.__isStateless ? null : instance);
            }
        }

        //如果在componentDidMount/Update钩子里执行了setState，那么再次渲染此组件
        if (this._renderInNextCycle === returnTrue) {
            this._renderInNextCycle = returnFalse;
            this.addJob("hydrate");
            updateQueue.push(this);
        }
    },
    dispose() {
        var instance = this.instance;
        options.beforeUnmount(instance);
        instance.setState = instance.forceUpdate = returnFalse;
        var vnode = this.vnode;
        if (vnode._hasRef) {
            Refs.fireRef(vnode, null);
        }
        captureError(instance, "componentWillUnmount", []);
        //在执行componentWillUnmount后才将关联的元素节点解绑，防止用户在钩子里调用 findDOMNode方法
        this._renderInNextCycle = this.isMounted = returnFalse;
        this._disposed = true;
        delete vnode.child;
    }
};

export function getChildContext(instance, parentContext) {
    if (instance.getChildContext) {
        let context = instance.getChildContext();
        if (context) {
            parentContext = Object.assign({}, parentContext, context);
        }
    }
    return parentContext;
}

export function getContextByTypes(curContext, contextTypes) {
    let context = {};
    if (!contextTypes || !curContext) {
        return context;
    }
    for (let key in contextTypes) {
        if (contextTypes.hasOwnProperty(key)) {
            context[key] = curContext[key];
        }
    }
    return context;
}
